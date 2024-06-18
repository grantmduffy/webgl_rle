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
    frag_color = uint(15) * uint(abs(length(xy - vec2(0.5, 0.5)) - 0.2) < 0.05);  // center ring
    frag_color = max(
        uint(10) * uint(length(xy - vec2(0.1, 0.9)) < 0.05),
        frag_color
    );  // top left circle
    frag_color = max(
        uint(15. * float(xy.x > 0.9 && xy.y > 0.9) * (xy.x - 0.9) * 10.),
        frag_color
    );  // top right gradient
}

`;

rle_src = `#version 300 es

precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 xy;
out uint frag_color;
uniform usampler2D value_tex;
uniform usampler2D rle_tex;
uniform int res;
uniform int i;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    ivec2 ij_left = ij - ivec2(1 << i, 0);
    uint this_value = texelFetch(value_tex, ij, 0).x;
    uint this_len = texelFetch(rle_tex, ij, 0).x;
    uint left_value = texelFetch(value_tex, ij_left, 0).x;
    uint left_len = texelFetch(rle_tex, ij_left, 0).x;
    uint out_len = this_len + left_len;
    if (
            ij_left.x > 0                   // in bounds
            && this_len == uint(1 << i)     // current value isn't limitted
            && this_value == left_value     // values are in the same block
    ){
        frag_color = this_len + left_len;   // count
    } else {
        frag_color = this_len;              // stop counting
    }
}

`;

sum_prep_src = `#version 300 es

#define max_count_large 255
#define max_count_small 15
#define max_value 15

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

in vec2 xy;
out uint frag_color;
uniform usampler2D value_tex;
uniform usampler2D rle_tex;
uniform int res;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    uint val = texelFetch(value_tex, ij, 0).x;
    uint len = texelFetch(rle_tex, ij, 0).x;
    // frag_color = (val << 28) | (len & uint(0x0fffffff));
    if (val == uint(0) || val == uint(max_value)){
        if (((len - uint(1)) % uint(max_count_large - 1)) == uint(0)){
            frag_color = uint(2);
        } else {
            frag_color = uint(0);
        }
    } else {
        if (((len - uint(1)) % uint(max_count_small - 1)) == uint(0)){
            frag_color = uint(1);
        } else {
            frag_color = uint(0);
        }
    }
    frag_color |= val << 28;
}

`

cumsum_src = `#version 300 es

precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 xy;
out uint frag_color;
uniform usampler2D value_tex;
uniform usampler2D rle_tex;
uniform int res;
uniform int i;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    uint this_value = texelFetch(value_tex, ij, 0).x;
    uint this_len = texelFetch(rle_tex, ij, 0).x;
    uint right_value = texelFetch(value_tex, ij + ivec2(1 << i, 0), 0).x;
    uint right_len = texelFetch(rle_tex, ij + ivec2(1 << i, 0), 0).x;
    uint out_len = this_len + right_len;
    if (
            1 << i < res                    // in bounds
            && this_len == uint(1 << i)     // current value isn't limitted
            && this_value == right_value    // values are in the same block
        ){
        frag_color = this_len + right_len;  // count
    } else {
        frag_color = this_len;              // stop counting
    }
}

`;

canvas_src = `#version 300 es

#define max_count_large 127
#define max_count_small 15
#define max_value 15

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

in vec2 xy;
out vec4 frag_color;
uniform usampler2D value_tex;
uniform usampler2D rle_tex;
uniform usampler2D count_tex;
uniform int res;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    uint val_uint = texelFetch(value_tex, ij, 0).x;
    uint len_uint = texelFetch(rle_tex, ij, 0).x;
    uint count_uint = texelFetch(count_tex, ij, 0).x;

    float val = float(count_uint >> 28) / float(max_value);
    uint count = count_uint & uint(0x0fffffff);

    frag_color = vec4(
        float(count == uint(2)), 
        float(count == uint(1)), 
        val, 
        1.
    );
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
    rle_program = link_program(vs, compile_shader(rle_src, gl.FRAGMENT_SHADER));
    sum_prep_program = link_program(vs, compile_shader(sum_prep_src, gl.FRAGMENT_SHADER));
    canvas_program = link_program(vs, compile_shader(canvas_src, gl.FRAGMENT_SHADER));

    vert_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vert_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, 1, 1,
        -1, -1, 1, 1, -1, 1
    ]), gl.STATIC_DRAW);

    // setup textures

    // TEXTURE 0: value texture, uint8
    gl.activeTexture(gl.TEXTURE0);
    value_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, value_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 
        new Uint8Array(Array(res * res).fill(0).flat()));

    // TEXTURE 1: reverse run length, uint16 (pair swapping)
    gl.activeTexture(gl.TEXTURE0 + 1);
    rle_in_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rle_in_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, 
        new Uint16Array(Array(res * res).fill(1).flat()));
    rle_out_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rle_out_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, 
        new Uint16Array(Array(res * res).fill(1).flat()));
    
    // TEXTURE 2: cumsum/value texture, uint32 (4-bit value, 28 bit count) (pair swapping)
    gl.activeTexture(gl.TEXTURE0 + 2);
    cumsum_in_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, cumsum_in_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_INT,
        new Uint32Array(Array(res * res).fill(0).flat()));
    cumsum_out_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, cumsum_out_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_INT,
        new Uint32Array(Array(res * res).fill(0).flat()));
    
    // TEXTURE 3: output texture, uint8 rle encoded stream
    gl.activeTexture(gl.TEXTURE0 + 3);
    out_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, out_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE,
        new Uint8Array(Array(res * res).fill(0).flat()));

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
    gl.bindFramebuffer(gl.FRAMEBUFFER, run_length_fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_out_texture, 0);

    // setup cumsum_fbo
    cumsum_fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, cumsum_fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cumsum_out_texture, 0);

    // setup output_fbo
    out_fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, out_fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0);

    // render to value fbo
    gl.useProgram(image_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, value_fbo);
    vert_attr = gl.getAttribLocation(rle_program, 'vert_pos');
    gl.enableVertexAttribArray(vert_attr);
    gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    gl.activeTexture(gl.TEXTURE0 + 1);
    for (i = 0; i <= 9; i++){

        // render to run_length_fbo
        gl.useProgram(rle_program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, run_length_fbo);
        gl.uniform1i(gl.getUniformLocation(rle_program, 'value_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(rle_program, 'rle_tex'), 1);
        gl.uniform1i(gl.getUniformLocation(rle_program, 'res'), res);
        gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), i);
        gl.bindTexture(gl.TEXTURE_2D, rle_in_texture);
        vert_attr = gl.getAttribLocation(rle_program, 'vert_pos');
        gl.enableVertexAttribArray(vert_attr);
        gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // swap textures
        [rle_in_texture, rle_out_texture] = [rle_out_texture, rle_in_texture];
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_out_texture, 0);
        gl.bindTexture(gl.TEXTURE_2D, rle_in_texture);
    }
    // return;
    // prepare for summation step
    gl.useProgram(sum_prep_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cumsum_fbo);
    gl.uniform1i(gl.getUniformLocation(sum_prep_program, 'value_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(sum_prep_program, 'rle_tex'), 1);
    gl.uniform1i(gl.getUniformLocation(sum_prep_program, 'res'), res);
    vert_attr = gl.getAttribLocation(sum_prep_program, 'vert_pos');
    gl.enableVertexAttribArray(vert_attr);
    gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap textures
    // [rle_in_texture, rle_out_texture] = [rle_out_texture, rle_in_texture];
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_out_texture, 0);
    // gl.bindTexture(gl.TEXTURE_2D, rle_in_texture);
    // return;
    // render to canvas
    gl.useProgram(canvas_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, rle_in_texture);
    gl.uniform1i(gl.getUniformLocation(canvas_program, 'value_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(canvas_program, 'rle_tex'), 1);
    gl.uniform1i(gl.getUniformLocation(canvas_program, 'count_tex'), 2);
    gl.uniform1i(gl.getUniformLocation(canvas_program, 'res'), res);
    vert_attr = gl.getAttribLocation(canvas_program, 'vert_pos');
    gl.enableVertexAttribArray(vert_attr);
    gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);


}