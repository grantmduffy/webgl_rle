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

value_src = `#version 300 es

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

#define max_run_small uint(15)
#define max_run_large uint(127)

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

uniform usampler2D value_tex;
uniform usampler2D rle_tex;
uniform int step;
uniform int i;

in vec2 xy;
out uvec2 frag_color;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    ivec2 ij_left = ij - ivec2(1 << i, 0);
    ivec2 ij_right = ij + ivec2(1 << i, 0);
    uint this_value = texelFetch(value_tex, ij, 0).x;
    uint left_value = texelFetch(value_tex, ij_left, 0).x;
    uint right_value = texelFetch(value_tex, ij_right, 0).x;
    uvec2 this_rle = texelFetch(rle_tex, ij, 0).xy;
    uvec2 left_rle = texelFetch(rle_tex, ij_left, 0).xy;
    uvec2 right_rle = texelFetch(rle_tex, ij_right, 0).xy;
    
    switch (step) {
        case 0: // set to ones before run count
            frag_color = uvec2(1, ij.x);
            break;
        case 1: // do run count
            if (
                ij_left.x > 0 &&
                this_rle.x == uint(1 << i) &&
                this_value == left_value
            ) {
                frag_color = uvec2(
                    this_rle.x + left_rle.x,
                    this_rle.y
                );
            } else {
                frag_color = this_rle;
            }
            break;
        case 2:
            frag_color = this_rle;
            frag_color.x = ((this_value == uint(0)) || (this_value == uint(15))) ?
                           (this_rle.x - uint(1)) % max_run_large + uint(1): 
                           (this_rle.x - uint(1)) % max_run_small + uint(1);
            break;
        default:
            break;
    }
    
}`;

output_src = `#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 xy;
out uint frag_color;

void main(){

}`;

canvas_src = `#version 300 es

#define max_run_small uint(15)
#define max_run_large uint(127)

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

uniform usampler2D value_tex;
uniform usampler2D rle_tex;
uniform usampler2D out_tex;

in vec2 xy;
out vec4 frag_color;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    uint val = texelFetch(value_tex, ij, 0).x;
    uvec2 rle = texelFetch(rle_tex, ij, 0).xy;
    // frag_color = vec4(float(val) / 15., float(rle.x) / 512., float(rle.y) / 512., 1.);
    frag_color = vec4(
        float(val) / float(max_run_small),
        val == uint(0) || val == uint(15) ? float(rle.x) / float(max_run_large) : float(rle.x) / float(max_run_small),
        float(rle.y) / 512.,
        1.
    );
}`;

/*
uint   uint8  texture0 value
uivec2 uint16 texture1 cumsum/idx swap-pair
uint   uint8  texture2 output
*/


const res = 512;

function main(){

    // setup gl
    let canvas = document.getElementById('canvas');
    gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true});
    gl.getExtension("OES_texture_float_linear");
    gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("EXT_float_blend");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.disable(gl.DITHER);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // compile programs
    let vs = compile_shader(vs_src, gl.VERTEX_SHADER);
    let value_program = link_program(vs, compile_shader(value_src, gl.FRAGMENT_SHADER));
    let rle_program = link_program(vs, compile_shader(rle_src, gl.FRAGMENT_SHADER));
    let output_program = link_program(vs, compile_shader(output_src, gl.FRAGMENT_SHADER));
    let canvas_program = link_program(vs, compile_shader(canvas_src, gl.FRAGMENT_SHADER));
    let programs = [value_program, rle_program, output_program, canvas_program];

    // vert buffer
    let vert_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vert_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, 1, 1,
        -1, -1, 1, 1, -1, 1
    ]), gl.STATIC_DRAW);
    for (const program of programs){
        gl.useProgram(program);
        let vert_attr = gl.getAttribLocation(program, 'vert_pos');
        gl.enableVertexAttribArray(vert_attr);
        gl.vertexAttribPointer(vert_attr, 2, gl.FLOAT, gl.FALSE, 2 * 4, 0);
        gl.uniform1i(gl.getUniformLocation(program, 'value_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'rle_tex'), 1);
        gl.uniform1i(gl.getUniformLocation(program, 'out_tex'), 2);
    }
    
    // TEXTURE 0: value texture, uint8
    gl.activeTexture(gl.TEXTURE0);
    let value_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, value_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 
        new Uint8Array(Array(res * res).fill(0).flat()));
    
    // TEXTURE 1: cumsum texture, uint16 uvec2
    gl.activeTexture(gl.TEXTURE0 + 1);
    var rle_texture_in = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, res, res, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, 
        new Uint32Array(Array(res * res * 2).fill(0).flat()));
    var rle_texture_out = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, res, res, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, 
        new Uint32Array(Array(res * res * 2).fill(0).flat()));

    // TEXTURE 2: output texture, uint8
    gl.activeTexture(gl.TEXTURE0 + 1);
    let out_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, out_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, res, res, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 
        new Uint8Array(Array(res * res).fill(0).flat()));

    // setup fbo, use same fbo but swap color attachment0
    fbo = gl.createFramebuffer();
    depthbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, res, res);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    
    // render to value texture
    gl.useProgram(value_program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, value_texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // do rle
    gl.useProgram(rle_program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 0);
    gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap textures
    [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 1);
    for (let i = 0; i < 9; i ++){
        gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // swap textures
        [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
        gl.activeTexture(gl.TEXTURE0 + 1);
        gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    
    }

    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap textures
    [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);

    // render to output
    gl.useProgram(output_program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0);

    // render to canvas
    gl.useProgram(canvas_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

}
