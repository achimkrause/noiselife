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

  vec4 mask(int ix, int iy, vec4 color){
      int mask = 1;
      for(int i=-3;i<=3;i++){
        for(int j=-3; j<=3; j++){
          int w = getWeight(ix*8+3-i,iy*8+3-j);
          mask+= (w*getState(i,j) - max(w,0));
        }
      }
      return float(max(mask,0))*color;
  }

  void main(){
    float current = float(getState(0,0));

    vec4 marks = vec4(0.0,0.0,0.0,0.0);
    for(int j=0;j<=7;j++){
      marks += mask(0,j,vec4(1.0,0.0,0.0,1.0));
      marks += mask(1,j,vec4(1.0,0.0,0.0,1.0));
    }
    marks += mask(2,0,vec4(0.0,0.0,1.0,1.0));
    marks += mask(2,1,vec4(1.0,1.0,0.0,1.0));
    marks += mask(2,2,vec4(1.0,1.0,0.0,1.0));
    marks.a = min(marks.a, 1.0);

    int x = int(gl_FragCoord.x);
    int y = int(gl_FragCoord.y);
    fragColor = marks.a*marks + (1.0-marks.a)*texture(state, (gl_FragCoord.xy / scale));
//    fragColor = (0.5+0.5*float(getWeight(x,y))) * vec4(1.0,1.0,1.0,0.0) + vec4(0.0,0.0,0.0,1.0);
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
  let marking = false;

  const image = new Image();
  image.onload = function(){
    console.log('loaded');
    gl.activeTexture(gl.TEXTURE4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 100, 100, gl.RGBA, gl.UNSIGNED_BYTE, image);
  };
  image.src = "data:image/png;base64,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SNF+3Mc/6PpFcsnkKkEhxwIq0CC5frA/+N2tlZ8Y95LCcaDzxXE+hoHQLtCoOc73seM0ToDgM3Clt/yVOjD9SXqtpUWPgL5t4OK6pcl7wOUOMPBkSKbkSkGaXD4PvJ/RN2WByC3Qveb11tzH6QOQpq6SN8DBITBSoOx1n3d3tff275lmfz+iaHK65ni98gAAD8NpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+Cjx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDQuNC4wLUV4aXYyIj4KIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIgogICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIKICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgIHhtbG5zOkdJTVA9Imh0dHA6Ly93d3cuZ2ltcC5vcmcveG1wLyIKICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIgogICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICB4bXBNTTpEb2N1bWVudElEPSJnaW1wOmRvY2lkOmdpbXA6MWNlNTI5YjQtMjYwNi00NzZjLWIzMmUtYjk2NzU2YjFjNjVlIgogICB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOmI3MWRiMzM1LTg5MzUtNGJiNC1iNjdjLWRmM2U1ZTY4MjEwOSIKICAgeG1wTU06T3JpZ2luYWxEb2N1bWVudElEPSJ4bXAuZGlkOmZkODY4ZjJkLWRhZTktNGE5NS1iMGU3LWM3MDhhNGYyNDg1YiIKICAgZGM6Rm9ybWF0PSJpbWFnZS9wbmciCiAgIEdJTVA6QVBJPSIyLjAiCiAgIEdJTVA6UGxhdGZvcm09IkxpbnV4IgogICBHSU1QOlRpbWVTdGFtcD0iMTYzNzQyNjkxOTg4NTQyNCIKICAgR0lNUDpWZXJzaW9uPSIyLjEwLjI4IgogICB0aWZmOk9yaWVudGF0aW9uPSIxIgogICB4bXA6Q3JlYXRvclRvb2w9IkdJTVAgMi4xMCI+CiAgIDx4bXBNTTpIaXN0b3J5PgogICAgPHJkZjpTZXE+CiAgICAgPHJkZjpsaQogICAgICBzdEV2dDphY3Rpb249InNhdmVkIgogICAgICBzdEV2dDpjaGFuZ2VkPSIvIgogICAgICBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjNmYTYxNGEyLWNhNzktNGFiOS1iZjBjLTUyZWIzMTE3MzQ4YiIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iR2ltcCAyLjEwIChMaW51eCkiCiAgICAgIHN0RXZ0OndoZW49IjIwMjEtMTEtMjBUMTI6NTg6NDYrMDE6MDAiLz4KICAgICA8cmRmOmxpCiAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6N2UyMjI1YmMtM2QxNS00OWE5LWI0ZmMtNjQ3ZWNiMjljYjc3IgogICAgICBzdEV2dDpzb2Z0d2FyZUFnZW50PSJHaW1wIDIuMTAgKExpbnV4KSIKICAgICAgc3RFdnQ6d2hlbj0iMjAyMS0xMS0yMFQxMzowNjo1NSswMTowMCIvPgogICAgIDxyZGY6bGkKICAgICAgc3RFdnQ6YWN0aW9uPSJzYXZlZCIKICAgICAgc3RFdnQ6Y2hhbmdlZD0iLyIKICAgICAgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDoyNjJkYWQ2Yi0zZjE2LTQ5MDgtOGVmZC02MTM1MzU5Y2I1ODciCiAgICAgIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkdpbXAgMi4xMCAoTGludXgpIgogICAgICBzdEV2dDp3aGVuPSIyMDIxLTExLTIwVDEzOjEyOjUzKzAxOjAwIi8+CiAgICAgPHJkZjpsaQogICAgICBzdEV2dDphY3Rpb249InNhdmVkIgogICAgICBzdEV2dDpjaGFuZ2VkPSIvIgogICAgICBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjk4M2UwN2VlLWIwODEtNGU1Yy05N2EyLTJiY2Y0ZmQ3ZDljNCIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iR2ltcCAyLjEwIChMaW51eCkiCiAgICAgIHN0RXZ0OndoZW49IjIwMjEtMTEtMjBUMTc6NDg6MzkrMDE6MDAiLz4KICAgIDwvcmRmOlNlcT4KICAgPC94bXBNTTpIaXN0b3J5PgogIDwvcmRmOkRlc2NyaXB0aW9uPgogPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+VFKH6AAAAAZiS0dEAP8A/wD/oL2nkwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB+ULFBAwJ0Sc8aAAAALvSURBVHja7ZzbbsQgDERx1f//ZfclSb0GA+GS7eWMVFVd0hdP7PFgWEkpaQqgqklE0q51kOPzzsOWOQk+92tgkBDtJEM0JS1EXI4HFDbWZYgYVlRSVm5e1lNqliPK1X18ZJkg32+5ap43KiYbzLr9P6shYIIQG+zSu30RJblm2B+woGTJUYYiDZCGyIM1EDV1RUSqZWZkHR25Scj5opdaWu8j/DP4kM0acom1C766thc8bAxLXqPmM7RTc8DNkuWDLgVTeHVjjpDMwxDbdRpS0ojaepQhaMhk29tibmQNTDp18Md9CH5kQEPCbXXmIW/UkKPV1VSfdfRso0DBhIaobVU1qmt9phDTuChDQiKOljYii3nIpi7rnGWU5hkv5evmvIN5yECG9L7D3r3XngELRH3UFCLkv9SHoCk3fMgKn9HaCwM3RH0WdjfYzlTAoIa0Drr1HISzM5To7Bbo0ZAj3tGs4yQkmpX4DOntyEClZEVvtD935U3kuS7mGUsGPmS0ZElnKglt72PGUBvEUIbwIfiQUR8yOk8BG3xI1mER03lRn/Uip+DjPxZniHfaflvEroOHSlZ0/6N6cpHs2KshUdBLk0OhLd6jIaWgasr/Lt4vJI74kH/hQ1bf/8CHLGh7w41GYvWetve62Fmsb6+/PWEKcetKVuuOR+/9EbqthRniz2d5gbalTAo+xbfFzEMmNKTnvG5tix5zuMGH9NS3Wt2jXOFD/raoZ9shk/MOfMiAqPfeQY/usIMNXVbPlvop2my/79aQBeeywMIMKZ2pKvkIf+aqx2fgQwbb3pk76mCjUwf4EBD5kBEfgQ/ZpCHNlhc9ed4YtuYZHIR70Ie05iAtnwIWd1klD2J9RM/9EXzIYmNYm2VE39cLNop6tCUCB/gQfAg+5IeJOoAQMFKyABkCIYQAQgCEQAiAEAgBEAIhAEIgBEAIgBAIARACIQBCIARACIQACAEQAiEAQiAEQAiEAAiBEAAhAEIgBNzDF9eZ5a3dQemAAAAAAElFTkSuQmCC";


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
    gl.viewport(0,0,1024,1024);
    gl.useProgram(drawProgram.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.vertexAttribPointer(drawProgram.attributes['v_position'], 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(drawProgram.attributes['v_position'])
    gl.uniform2f(drawProgram.uniforms['scale'], scale, scale);
    gl.uniform1i(drawProgram.uniforms['state'], textureIndex);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }

  let draw = function(scale){
    if(marking){
      gol.mark();
      drawTexture(scale,markFrontIndex);
    }
    else{
      drawTexture(scale,frontIndex);
    }
  }

  let swap = function(){
    let tmp = back;
    back=front;
    front=tmp;
    let tmp1 = backIndex;
    backIndex=frontIndex;
    frontIndex=tmp1;
  }

  let setMarking = function(val){
    marking=val;
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

  return {draw: draw, step:step, set:set, setP:setP, mark:mark, setMarking:setMarking}
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
  document.getElementById('marking').addEventListener('change', (e) => {
    if(e.currentTarget.checked){
      gol.setMarking(true);
    }
    else{
      gol.setMarking(false);
    }
  })

  let running=true;
  document.addEventListener('keydown', (e) => {
    if(e.key===' '){
      if(e.target == document.body){
        e.preventDefault();
      }
      running= !running
    }
  });

  gol.draw(2*512);
  window.setInterval(() => {
    if(running){
      gol.step();
    }
    gol.draw(2*512);
  }, 10);
}

window.onload=main;
