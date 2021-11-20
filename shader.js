const vsTrivial = 
`#version 300 es
 in vec4 v_position;
 void main(){
   gl_Position = v_position;
 }
`;

const fsDraw = 
 `#version 300 es
  #ifdef GL_ES
  precision mediump float;
  #endif
  uniform vec2 scale;
  uniform sampler2D state;
  out vec4 fragColor;

  void main(){
    fragColor = texture(state, (gl_FragCoord.xy) / scale);
  }
`;

const fsMark = 
 `#version 300 es
  #ifdef GL_ES
  precision mediump float;
  #endif
  uniform vec2 scale;
  uniform sampler2D state;
  uniform sampler2D masks;
  out vec4 fragColor;
 
  int getState(int x, int y) {
      return int(texture(state, (gl_FragCoord.xy + vec2(x, y)) / scale).r);
  }

  int getWeight(int s, int t) {
      vec4 color = texture(masks, vec2(s, t) / scale);
      return int(color.g - color.r);
  }

  vec4 mask(int s, int t, int rleft, int rbottom, int rright, int rtop, int hflip, int vflip){
      int mask = 0;
      for(int i=-rleft;i<=rright;i++){
        for(int j=-rbottom; j<=rtop; j++){
          int w = getWeight(s,t);
          mask+= (w*getState(s+hflip*i,s+vflip*j) - max(w,0))*abs(sign(i))*abs(sign(j));
        }
      }
      return float(max(mask,0))*texture(state, vec2(s, t) / scale);
  }

  void main(){
    float current = float(getState(0,0));

    vec4 masks = mask(1,1,-1,-1,3,3,1,1);
    masks += mask(1,1,-1,-1,3,3,-1,1);
    masks += mask(1,1,-1,-1,3,3,1,-1);
    masks += mask(1,1,-1,-1,3,3,-1,-1);
    masks += mask(7,2,-2,-2,2,2,1,1);
    masks += mask(7,2,-2,-2,2,2,-1,1);
    masks += mask(7,2,-2,-2,2,2,1,-1);
    masks += mask(7,2,-2,-2,2,2,-1,-1);
    masks += mask(12,2,-2,-2,1,1,1,1);


    fragColor = masks;
  }`

const fsFlood = 
 `#version 300 es
  #ifdef GL_ES
  precision mediump float;
  #endif
  uniform vec2 scale;
  uniform sampler2D state;
  out vec4 fragColor;
 
  vec4 get(int x, int y) {
      return texture(state, (gl_FragCoord.xy + vec2(x, y)) / scale);
  }

  vec4 maskBlack(int x, int y){
     vec4 v = get(x,y);
     float maskBit = (1.0-sign(v.r))*(1.0-sign(v.g))*(1.0-sign(v.b));
     return max(v,vec4(maskBit,maskBit,maskBit,1.0));
  }

  void main(){
     fragColor = get(0,0);
     fragColor = min(maskBlack(1,0),fragColor);
     fragColor = min(maskBlack(0,1),fragColor);
     fragColor = min(maskBlack(0,-1),fragColor);
     fragColor = min(maskBlack(-1,0),fragColor);
     fragColor = min(maskBlack(1,1),fragColor);
     fragColor = min(maskBlack(0,-0),fragColor);
     fragColor = min(maskBlack(1,-1),fragColor);
     fragColor = min(maskBlack(-1,1),fragColor);
     fragColor = min(maskBlack(-1,-1),fragColor);
  }`


const fsStep = 
 `#version 300 es
  #ifdef GL_ES
  precision mediump float;
  #endif
  uniform vec2 scale;
  uniform sampler2D state;
  uniform uint seed;
  uniform float p;
  out vec4 fragColor;

  uint hash(uint x, uint y){
    uint hash = seed;
    hash += x;
    hash += (hash << 10);
    hash ^= (hash >> 6);
    hash += y;
    hash += (hash << 10);
    hash ^= (hash >> 6);
    hash += (hash << 3);
    hash ^= (hash >> 11);
    hash += (hash << 15);
    return hash;
  }

  int roll(uint x, uint y){
    uint threshold = uint(float(uint(-1))*p);
    if(threshold >= hash(x,y)){
      return 1;
    }
    else{
      return 0;
    }
  }
  
  int get(int x, int y) {
      return int(texture(state, (gl_FragCoord.xy + vec2(x, y)) / scale).r);
  }
  
  void main() {
      int sum = get(-1, -1) +
                get(-1,  0) +
                get(-1,  1) +
                get( 0, -1) +
                get( 0,  1) +
                get( 1, -1) +
                get( 1,  0) +
                get( 1,  1);
      if (sum == 3) {
          fragColor = vec4(1.0, 1.0, 1.0, 1.0);
      } else if (sum == 2) {
          float current = float(get(0, 0));
          fragColor = vec4(current, current, current, 1.0);
      } else {
          fragColor = vec4(0.0, 0.0, 0.0, 1.0);
      }
      if(1==roll(uint(gl_FragCoord.x),uint(gl_FragCoord.y))){
         fragColor = vec4(1.0,1.0,1.0,2.0) - fragColor;
      }
  }
`;


function initGOL(canvas){
  const gl = canvas.getContext('webgl2');

  //init stepProgram
  const stepProgram = createProgram(gl,vsTrivial,fsStep, ['v_position'], ['state','scale','p','seed']);

  //init drawProgram
  const drawProgram = createProgram(gl,vsTrivial,fsDraw, ['v_position'], ['state','scale']);

  const markProgram = createProgram(gl,vsTrivial,fsMark, ['v_position'], ['state','scale','masks']);
  const floodProgram = createProgram(gl,vsTrivial,fsFlood, ['v_position'], ['state','scale']);

  const buffer = createQuadVertexBuffer(gl); //we never use this buffer.bind(), since so far we never need to bind another buffer.

  let data = new Uint8Array(4*512*512).fill(0);

  let masks = createTexture(gl,gl.TEXTURE4,data);
  let masksIndex = 4;

  const image = new Image();
  image.onload = function(){
    console.log('loaded');
    gl.activeTexture(gl.TEXTURE4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 100, 100, gl.RGBA, gl.UNSIGNED_BYTE, image);
  };
  image.src = "masks.png";

  for(let i=0; i<512*512; i++){
    let val = 255*Math.floor(Math.random()*2);
    data[4*i] = val;
    data[4*i+1] = val;
    data[4*i+2] = val;
    data[4*i+3] = 255;
  }
  
  let front = createTexture(gl,gl.TEXTURE0,data);
  let frontIndex = 0;

  let back = createTexture(gl,gl.TEXTURE1,data);
  let backIndex = 1;

  let markFront = createTexture(gl,gl.TEXTURE2,data);
  let markFrontIndex = 2;

  let markBack = createTexture(gl,gl.TEXTURE3,data);
  let markBackIndex = 3;


  let p = 0.00001;

  const frameBuffer = gl.createFramebuffer();

  let drawTexture = function(scale,textureIndex){
    gl.viewport(0,0,1000,1000);
    gl.useProgram(drawProgram.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.vertexAttribPointer(drawProgram.attributes['v_position'], 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(drawProgram.attributes['v_position'])
    gl.uniform2f(drawProgram.uniforms['scale'], scale, scale);
    gl.uniform1i(drawProgram.uniforms['state'], textureIndex);
    console.log('drawing: '+textureIndex);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }

  let draw = function(scale){
    drawTexture(scale,markFrontIndex);
  }

  let swap = function(){
    let tmp = back;
    back=front;
    front=tmp;
    let tmp1 = backIndex;
    backIndex=frontIndex;
    frontIndex=tmp1;
  }

  let step = function(){
    //gl.bindTexture(gl.TEXTURE_2D, front);
    gl.bindFramebuffer(gl.FRAMEBUFFER,frameBuffer);
    gl.useProgram(stepProgram.program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, back, 0);
    gl.viewport(0,0,512,512);
    gl.vertexAttribPointer(stepProgram.attributes['v_position'], 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(stepProgram.attributes['v_position'])
    gl.uniform2f(stepProgram.uniforms['scale'], 512,512);
    gl.uniform1i(stepProgram.uniforms['state'], frontIndex);
    gl.uniform1ui(stepProgram.uniforms['seed'], Math.floor(Math.random()*4294967296));
    gl.uniform1f(stepProgram.uniforms['p'], p);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    swap();
  }

  let mark = function(){;
    gl.bindFramebuffer(gl.FRAMEBUFFER,frameBuffer);
    gl.useProgram(markProgram.program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, markFront, 0);
    gl.viewport(0,0,512,512);
    gl.vertexAttribPointer(markProgram.attributes['v_position'], 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(markProgram.attributes['v_position'])
    gl.uniform2f(markProgram.uniforms['scale'], 512,512);
    gl.uniform1i(markProgram.uniforms['state'], frontIndex);
    gl.uniform1i(markProgram.uniforms['masks'], masksIndex);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    gl.useProgram(floodProgram.program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, markBack, 0);
    gl.vertexAttribPointer(floodProgram.attributes['v_position'], 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(floodProgram.attributes['v_position'])
    gl.uniform2f(floodProgram.uniforms['scale'], 512,512);
    gl.uniform1i(floodProgram.uniforms['state'], markFrontIndex);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, markFront, 0);
    gl.uniform1i(floodProgram.uniforms['state'], markBackIndex);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }

  let set = function(offsetX, offsetY, positions){
    let data = new Uint8Array(4*512*512).fill(0);
    for(let i=0; i<512*512; i++){
      data[4*i+3] = 255;
    }
    for(let i=0; i<positions.length; i++)
    {
      let index = 4*((positions[i][0]+offsetX)*512+positions[i][1]+offsetY);
      data[index]=255;
      data[index+1]=255;
      data[index+2]=255;
    }
    gl.activeTexture(gl.TEXTURE0 + frontIndex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  let setP=function(newP){
    p=newP;
  }

  return {draw: draw, step:step, set:set, setP:setP, mark:mark}
}

function createProgram(gl,vsSource,fsSource,attribs,unifs){
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader,vsSource);
  gl.compileShader(vertexShader);
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, fsSource);
  gl.compileShader(fragmentShader);

  var compiled = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
  console.log('Shader compiled successfully: ' + compiled);
  var compilationLog = gl.getShaderInfoLog(fragmentShader);
  console.log('Shader compiler log: ' + compilationLog);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program));
    return null;
  }

  attributes={};
  for(let i=0; i<attribs.length; i++){
    let loc = gl.getAttribLocation(program,attribs[i]);
    attributes[attribs[i]]=loc;
  }

  uniforms={};
  for(let i=0; i<unifs.length; i++){
    let loc = gl.getUniformLocation(program,unifs[i]);
    uniforms[unifs[i]]=loc;
  }

  return {program: program, attributes: attributes, uniforms: uniforms};
}

function createTexture(gl,activeTexture, data){
  gl.activeTexture(activeTexture);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE,data);
  return texture;
}

function createQuadVertexBuffer(gl){
  let quad_vertex_buffer = gl.createBuffer();
  let quad_vertex_buffer_data = new Float32Array([ 
    -1.0, -1.0, 0.0,
     1.0, -1.0, 0.0,
    -1.0,  1.0, 0.0,
     1.0,  1.0, 0.0]);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad_vertex_buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad_vertex_buffer_data, gl.STATIC_DRAW);

  return {
    bind: function(){
      gl.bindBuffer(gl.ARRAY_BUFFER, quad_vertex_buffer);
    }
  }
}


let shapes = {
  square: [[0,0],[0,1],[1,0],[1,1]],
  blinker: [[0,0],[0,1],[0,2]],
  beehive: [[0,0],[0,1],[1,2],[2,1],[2,0],[1,-1]],
  glider: [[0,-2],[-1,-2],[-2,-2],[-2,-1],[-1,-0]],
  lwss: [[0,0],[1,1],[1,2],[1,3],[0,3],[-1,3],[-2,3],[-3,3],[-4,2]]
}

let gol;

function main(){
  gol = initGOL(document.getElementById('lifeCanvas'));

  document.getElementById('squareButton').onclick = () => gol.set(256,256,shapes['square']);
  document.getElementById('blinkerButton').onclick = () => gol.set(256,256,shapes['blinker']);
  document.getElementById('beehiveButton').onclick = () => gol.set(256,256,shapes['beehive']);
  document.getElementById('gliderButton').onclick = () => gol.set(256,256,shapes['glider']);
  document.getElementById('lwssButton').onclick = () => gol.set(256,256,shapes['lwss']);

  let setPClick = function(){
    let p = parseFloat(document.getElementById('fluctuationText').value);
    document.getElementById('fluctuationText').value=p;
    gol.setP(p);
  };
  document.getElementById('fluctuationButton').addEventListener('click', setPClick);
  document.getElementById('fluctuationText').addEventListener('keydown', (e) => {if(e.key==='Enter') setPClick()});

  gol.draw(2*500);
  window.setInterval(() => {
    gol.step();
    gol.mark();
    gol.draw(2*500);
  }, 10);
}

window.onload=main;
