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
    ivec2 ij = ivec2(gl_FragCoord.xy);
    frag_color = uint(15) * uint(abs(length(xy - vec2(0.5, 0.5)) - 0.2) < 0.05);  // center ring
    frag_color = max(
        uint(10) * uint(length(xy - vec2(0.1, 0.1)) < 0.05),
        frag_color
    );  // bottom left circle
    frag_color = max(
        uint(15. * float(xy.x > 0.9 && xy.y > 0.7) * (xy.x - 0.9) * 10.),
        frag_color
    );  // top right gradient
    if (xy.y > 0.9){
        frag_color = ij.x % 2 == 0 ? uint(15) : uint(0);
    }
}

`;

rle_src = `#version 300 es

#define max_run_small 15
// #define max_run_large 0x0fff
#define max_run_large 200

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;

uniform usampler2D value_tex;
uniform isampler2D rle_tex;
uniform int step, i, n, width, height;

in vec2 xy;
out ivec2 frag_color;

ivec2 ij, ij_left, ij_right;
uint this_value, left_value, right_value;
ivec2 this_rle, left_rle, right_rle;
int idx, idx_left, idx_right;

int ij2idx(ivec2 ij){
    return (height - ij.y - 1) * width + ij.x;
}

ivec2 idx2ij(int idx){
    return ivec2(idx % width, height - idx / width - 1);
}

void main(){
    ij = ivec2(gl_FragCoord.xy);
    this_value = texelFetch(value_tex, ij, 0).x;
    this_rle = texelFetch(rle_tex, ij, 0).xy;
    
    switch (step) {
        case 0: // set to ones before run count
            frag_color = ivec2(1, ij.x);
            break;
        case 1: // do run count
            idx = ij2idx(ij);
            idx_left = idx - (1 << i);
            ij_left = idx2ij(idx_left);
            left_value = texelFetch(value_tex, ij_left, 0).x;
            left_rle = texelFetch(rle_tex, ij_left, 0).xy;
            if (
                idx_left >= 0 &&
                this_rle.x == 1 << i &&
                this_value == left_value
            ) {
                frag_color = ivec2(
                    this_rle.x + left_rle.x,
                    this_rle.y
                );
            } else {
                frag_color = this_rle;
            }
            break;
        case 2: // prepare for cumsum
            bool is_large = this_value == uint(0) || this_value == uint(15);
            if ((this_rle.x - 1) % (is_large ? max_run_large : max_run_small) == 0){
                // new run
                frag_color = ivec2(is_large ? 1 : 0, ij.x);
            } else {
                // repeat value
                frag_color = ivec2(-1, -1);
            }
            break;
        case 3: // cumsum
            idx = ij2idx(ij);
            idx_left = idx - (1 << i);
            ij_left = idx2ij(idx_left);
            left_value = texelFetch(value_tex, ij_left, 0).x;
            left_rle = texelFetch(rle_tex, ij_left, 0).xy;
            frag_color = this_rle;
            if (ij_left.x >= 0){
                frag_color.x += left_rle.x;
            }
            break;
        case 4: // gather
            int left_mask = 1 << (n - i - 1);
            int right_mask = 1 << i;

            idx = ij2idx(ij);
            idx_left = idx - left_mask;
            idx_right = idx + right_mask;
            ij_left = idx2ij(idx_left);
            ij_right = idx2ij(idx_right);
            left_rle = texelFetch(rle_tex, ij_left, 0).xy;
            right_rle = texelFetch(rle_tex, ij_right, 0).xy;

            if (idx_left >= 0 && left_rle.y != -1 && left_rle.x > 0 && bool(left_rle.x & left_mask)) {
                // use left
                frag_color = left_rle;
            } else if (idx_right < width * height && right_rle.y != -1 && right_rle.x < 0 && bool(-right_rle.x & right_mask)) {
                // use right
                frag_color = right_rle;
            } else if (
                    this_rle.y != -1 && (
                        (this_rle.x >= 0 && !bool(this_rle.x & left_mask)) || 
                        (this_rle.x < 0 && !bool(-this_rle.x & right_mask))
                    )
                ) {
                // use this
                frag_color = this_rle;
            } else {
                // use default
                frag_color = ivec2(0, -1);
            }
            break;
        case 5:
            // post-process
            frag_color = this_rle;
            break;
        default:
            break;
    }
    
}`;

output_src = `#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;

uniform usampler2D value_tex;
uniform isampler2D rle_tex;
uniform usampler2D out_tex;
uniform int width;

in vec2 xy;
out uint frag_color;

void main(){
    ivec2 this_ij;
    ivec2 right_ij;
    ivec2 this_rle;
    ivec2 right_rle;
    bool first_byte = true;

    this_ij = ivec2(gl_FragCoord.xy);
    this_rle = texelFetch(rle_tex, this_ij, 0).xy;
    if (this_rle.y == -1){
        this_ij += ivec2(1, 0);
        this_rle = texelFetch(rle_tex, this_ij, 0).xy;
        first_byte = false;
    }
    if (this_rle.y == -1){
        frag_color = uint(0);
        return;
    }
    uint this_value = texelFetch(value_tex, ivec2(this_rle.y, this_ij.y), 0).x;
    right_ij = this_ij + ivec2(1, 0);
    right_rle = texelFetch(rle_tex, right_ij, 0).xy;
    if (right_rle.y == -1){
        right_ij += ivec2(1, 0);
        right_rle = texelFetch(rle_tex, right_ij, 0).xy;
    }
    int run_length = right_rle.y - this_rle.y;
    if (this_value == uint(0) || this_value == uint(15)){
        if (first_byte) {
            frag_color = this_value << 4 | uint(run_length & 0x0f00) >> 8;
        } else {
            frag_color = uint(run_length & 0x00ff);
        }
    } else {
        frag_color = this_value << 4 | uint(run_length & 0x0f);
        // frag_color = uint(run_length & 0x0f);
    }
}`;

canvas_src = `#version 300 es

#define max_run_small uint(15)
#define max_run_large uint(0x0fff)

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp isampler2D;

uniform usampler2D value_tex;
uniform isampler2D rle_tex;
uniform usampler2D out_tex;
uniform int width;
uniform int height;

in vec2 xy;
out vec4 frag_color;

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    uint val = texelFetch(value_tex, ij, 0).x;
    ivec2 rle = texelFetch(rle_tex, ij, 0).xy;
    int source_idx = rle.y;
    uint source_val = texelFetch(value_tex, ivec2(source_idx, ij.y), 0).x;
    uint out_byte = texelFetch(out_tex, ij, 0).x;
    // frag_color = vec4(
    //     float(rle.x == -1),
    //     float(rle.x == 0),
    //     float(rle.x == 1),
    //     1.
    // );
    // frag_color = vec4(
    //     float(rle.x) / float(width * height),
    //     -float(rle.x) / float(width * height),
    //     float(rle.y != -1) * 0.2,
    //     1.
    // );
    frag_color = vec4(
        float(out_byte) / 255.
    );
}`;

/*
uint   uint8  texture0 value
uivec2 uint16 texture1 cumsum/idx swap-pair
uint   uint8  texture2 output
*/


function main(){

    // setup gl
    let canvas = document.getElementById('canvas');
    let width = canvas.width;
    let height = canvas.height;
    let n_sum = Math.ceil(Math.log2(width * height))
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
        gl.uniform1i(gl.getUniformLocation(program, 'width'), width);
        gl.uniform1i(gl.getUniformLocation(program, 'height'), height);
        gl.uniform1i(gl.getUniformLocation(program, 'n'), n_sum);
    }
    
    // TEXTURE 0: value texture, uint8
    gl.activeTexture(gl.TEXTURE0);
    let value_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, value_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 
        new Uint8Array(Array(width * height).fill(0).flat()));
    
    // TEXTURE 1: cumsum texture, uint16 uvec2
    gl.activeTexture(gl.TEXTURE0 + 1);
    var rle_texture_in = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32I, width, height, 0, gl.RG_INTEGER, gl.INT, 
        new Int32Array(Array(width * height * 2).fill(-1).flat()));
    var rle_texture_out = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32I, width, height, 0, gl.RG_INTEGER, gl.INT, 
        new Int32Array(Array(width * height * 2).fill(-1).flat()));
    
    // TEXTURE 2: output texture, uint8
    gl.activeTexture(gl.TEXTURE0 + 2);
    let out_texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, out_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 
        new Uint8Array(Array(width * height).fill(0).flat()));

    // setup fbo, use same fbo but swap color attachment0
    fbo = gl.createFramebuffer();
    depthbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    
    // render to value texture
    gl.useProgram(value_program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, value_texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // do rle
    gl.useProgram(rle_program);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 0);
    gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap textures
    [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 1);
    for (let i = 0; i < n_sum; i++){
        gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // swap textures
        [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
        gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    
    }

    // prepare for cumsum
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap textures
    [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);

    // cumsum
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 3);
    for (let i = 0; i < n_sum; i++){
        gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // swap textures
        [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
        gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);

    }

    // gather
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), 4);
    for (let i = 0; i < n_sum; i++){
        gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // swap textures
        [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
        gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    }

    // render to output
    gl.useProgram(output_program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // render to canvas
    gl.useProgram(canvas_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

}
