vs_src = `#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vert_pos;
out vec2 xy;

void main(){
    gl_Position = vec4(vert_pos, 0., 1.);
    xy = vert_pos * 0.5 + 0.5;
}

`;

buffer_src = `#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 xy;
out vec4 frag_color;
uniform sampler2D in_tex;

void main(){
    frag_color = vec4(1., 0., 0., 1.);
}

`;

canvas_src = `#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 xy;
out vec4 frag_color;
uniform sampler2D in_tex;

void main(){
    vec4 tex_color = texture(in_tex, xy);
    frag_color = tex_color;
}

`;


function compile_shader(source, type){
    let shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
        throw new Error(print_error(source, gl.getShaderInfoLog(shader)));
    }
    return shader;
}


function link_program(vertex_shader, fragment_shader){
    let program = gl.createProgram();
    gl.attachShader(program, vertex_shader);
    gl.attachShader(program, fragment_shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)){
        console.error('Failed to link program:', gl.getProgramInfoLog(program));
        return;
    }
    gl.validateProgram(program);
    if (!gl.getProgramParameter(program, gl.VALIDATE_STATUS)){
        console.error('Failed to validate program:', gl.getProgramInfoLog(program));
        return;
    }
    return program;
}


function print_error(source, err){
    let errs = err.slice(0, -2).split('\n');
    let lines = source.split('\n');
    let out = '\n\n';
    for (let i_err = 0; i_err < errs.length; i_err++){
        let [_, char_start, line_num, glsl_err] = errs[i_err].match(/ERROR: ([0-9]+):([0-9]+): (.+)/);
        [char_start, line_num] = [parseInt(char_start), parseInt(line_num)];
        out += `GLSL Error ${i_err}: ${glsl_err}\n${line_num - 1}: ${lines[line_num - 2].trimEnd()}\n${line_num}:*${lines[line_num - 1].trimEnd()}\n${line_num + 1}: ${lines[line_num].trimEnd()}\n`
    }
    return out;
}


res = 512


function main(){
    canvas = document.getElementById('canvas');
    gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true});
    gl.getExtension("OES_texture_float_linear");
    gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("EXT_float_blend");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.disable(gl.DITHER);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    vs = compile_shader(vs_src, gl.VERTEX_SHADER);
    buffer_program = link_program(vs, compile_shader(buffer_src, gl.FRAGMENT_SHADER));
    canvas_program = link_program(vs, compile_shader(canvas_src, gl.FRAGMENT_SHADER));

    vert_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vert_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, 1, 1,
        -1, -1, 1, 1, -1, 1
    ]), gl.STATIC_DRAW);

    // setup textures
    in_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, in_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, res, res, 0, gl.RGBA, gl.FLOAT, 
        new Float32Array(Array(res * res).fill([0, 1, 1, 1]).flat()));
    out_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, out_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, res, res, 0, gl.RGBA, gl.FLOAT, 
        new Float32Array(Array(res * res).fill([1, 0, 1, 1]).flat()));
    
    // setup fbo
    fbo = gl.createFramebuffer();
    depthbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, res, res);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0);
    
    // render to fbo
    gl.useProgram(buffer_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.bindTexture(gl.TEXTURE_2D, in_texture);
    vert_attr = gl.getAttribLocation(buffer_program, 'vert_pos');
    gl.enableVertexAttribArray(vert_attr);
    gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // render to canvas
    gl.useProgram(canvas_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, out_texture);
    vert_attr = gl.getAttribLocation(canvas_program, 'vert_pos');
    gl.enableVertexAttribArray(vert_attr);
    gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);


    console.log('done');
}