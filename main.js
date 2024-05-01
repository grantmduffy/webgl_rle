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

image_src = `#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 xy;
out uint frag_color;

void main(){
    frag_color = uint(length(xy - vec2(0.5, 0.5)) < 0.2);
}

`;

buffer_src = `#version 300 es

precision highp float;
precision highp int;
precision highp usampler2D;
precision highp isampler2D;

in vec2 xy;
out int frag_color;
uniform usampler2D value_tex;
uniform isampler2D rle_tex;
uniform int res;
uniform int i;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    uint this_value = texelFetch(value_tex, ij, 0).x;
    int this_len = texelFetch(rle_tex, ij, 0).x;
    uint right_value = texelFetch(value_tex, ij + ivec2(1 << i, 0), 0).x;
    int right_len = texelFetch(rle_tex, ij + ivec2(1 << i, 0), 0).x;
    int out_len = this_len + right_len;
    if (
            1 << i < res                    // in bounds
            && this_len == 1 << (i - 1)     // current value isn't limitted
            && this_value == right_value    // values are in the same block
        ){
        frag_color = this_len + right_len;  // count
    } else {
        frag_color = this_len;              // stop counting
    }
}

`;

canvas_src = `#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;

in vec2 xy;
out vec4 frag_color;
uniform usampler2D value_tex;
uniform isampler2D rle_tex;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    float val = float(texelFetch(rle_tex, ij, 0).x) / 255.;
    frag_color = vec4(vec3(val), 1.);
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
    image_program = link_program(vs, compile_shader(image_src, gl.FRAGMENT_SHADER));
    buffer_program = link_program(vs, compile_shader(buffer_src, gl.FRAGMENT_SHADER));
    canvas_program = link_program(vs, compile_shader(canvas_src, gl.FRAGMENT_SHADER));

    vert_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vert_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, 1, 1,
        -1, -1, 1, 1, -1, 1
    ]), gl.STATIC_DRAW);

    // setup textures
    gl.activeTexture(gl.TEXTURE0);
    value_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, value_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 
        new Uint8Array(Array(res * res).fill(0).flat()));
    gl.activeTexture(gl.TEXTURE0 + 1);
    in_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, in_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, res, res, 0, gl.RED_INTEGER, gl.SHORT, 
        new Int16Array(Array(res * res).fill(1).flat()));
    out_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, out_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, res, res, 0, gl.RED_INTEGER, gl.SHORT, 
        new Int16Array(Array(res * res).fill(1).flat()));
    
    // setup value_fbo
    value_fbo = gl.createFramebuffer();
    depthbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, res, res);
    gl.bindFramebuffer(gl.FRAMEBUFFER, value_fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, value_texture, 0);

    // setup run_length_fbo
    run_length_fbo = gl.createFramebuffer();
    depthbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, res, res);
    gl.bindFramebuffer(gl.FRAMEBUFFER, run_length_fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0);

    // render to value fbo
    gl.useProgram(image_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, value_fbo);
    vert_attr = gl.getAttribLocation(buffer_program, 'vert_pos');
    gl.enableVertexAttribArray(vert_attr);
    gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    for (i = 1; i <= 9; i++){

        // render to run_length_fbo
        gl.useProgram(buffer_program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, run_length_fbo);
        gl.uniform1i(gl.getUniformLocation(buffer_program, 'value_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(buffer_program, 'rle_tex'), 1);
        gl.uniform1i(gl.getUniformLocation(buffer_program, 'res'), res);
        gl.uniform1i(gl.getUniformLocation(buffer_program, 'i'), i);
        gl.bindTexture(gl.TEXTURE_2D, in_texture);
        vert_attr = gl.getAttribLocation(buffer_program, 'vert_pos');
        gl.enableVertexAttribArray(vert_attr);
        gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // swap textures
        [in_texture, out_texture] = [out_texture, in_texture];
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0);
        gl.bindTexture(gl.TEXTURE_2D, in_texture);
    }

    // render to canvas
    gl.useProgram(canvas_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, in_texture);
    gl.uniform1i(gl.getUniformLocation(canvas_program, 'value_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(canvas_program, 'rle_tex'), 1);
    vert_attr = gl.getAttribLocation(canvas_program, 'vert_pos');
    gl.enableVertexAttribArray(vert_attr);
    gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);


    console.log('done');
}