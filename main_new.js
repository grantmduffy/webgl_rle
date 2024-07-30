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
    if (xy.y > 0.98 && xy.x < 0.8){
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
    // return ij.y * width + ij.x;
}

ivec2 idx2ij(int idx){
    return ivec2(idx % width, height - idx / width - 1);
    // return ivec2(idx % width, idx / width);
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
        case 2: // prepare for repeat count
            idx = ij2idx(ij);
            bool is_large = this_value == uint(0) || this_value == uint(15);
            if ((this_rle.x - 1) % (is_large ? max_run_large : max_run_small) == 0){
                // new run
                frag_color = ivec2(0, idx);
            } else {
                // repeat value
                frag_color = ivec2(1, -1);
            }
            break;
        case 3: // prepare for double count
            // get source value
            int idx_src = this_rle.y - 1;  // if value to left is 0|15 : 1 else 0
            ivec2 ij_src = idx2ij(idx_src);
            uint src_value = texelFetch(value_tex, ij_src, 0).x;
            frag_color = this_rle;
            if (idx_src >= 0 && (src_value == uint(0) || src_value == uint(15))){
                frag_color.x = 1;
            } else {
                frag_color.x = 0;
            }
            break;
        case 4: // cumsum
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
        case 5: // gather left
            int right_mask = 1 << i;

            idx = ij2idx(ij);
            idx_right = idx + right_mask;
            ij_right = idx2ij(idx_right);
            right_rle = texelFetch(rle_tex, ij_right, 0).xy;

            if (idx_right < width * height && right_rle.y != -1 && bool(right_rle.x & right_mask)) {
                // use right
                frag_color = right_rle;
            } else if (this_rle.y != -1 && !bool(this_rle.x & right_mask)) {
                // use this
                frag_color = this_rle;
            } else {
                // use default
                frag_color = ivec2(0, -1);
            }
            break;
        case 6: // expand right
            int left_mask = 1 << (n - i - 1);

            idx = ij2idx(ij);
            idx_left = idx - left_mask;
            ij_left = idx2ij(idx_left);
            left_rle = texelFetch(rle_tex, ij_left, 0).xy;

            if (idx_left >= 0 && left_rle.y != -1 && bool(left_rle.x & left_mask)) {
                // use left
                frag_color = left_rle;
            } else if (this_rle.y != -1 && !bool(this_rle.x & left_mask)) {
                // use this
                frag_color = this_rle;
            } else {
                // default
                frag_color = ivec2(0, -1);
            }
            break;
        case 7:
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
uniform int width, height;

in vec2 xy;
out uint frag_color;

int ij2idx(ivec2 ij){
    return (height - ij.y - 1) * width + ij.x;
    // return ij.y * width + ij.x;
}

ivec2 idx2ij(int idx){
    return ivec2(idx % width, height - idx / width - 1);
    // return ivec2(idx % width, idx / width);
}

void main(){
    ivec2 this_ij = ivec2(gl_FragCoord.xy);
    int this_idx = ij2idx(this_ij);
    int this_src = texelFetch(rle_tex, this_ij, 0).y;
    frag_color = uint(0);
    int right_src;
    uint val, run;
    if (this_src == -1){  // must be the second byte of a large encoding
        this_src = texelFetch(rle_tex, idx2ij(this_idx - 1), 0).y;
        right_src =  texelFetch(rle_tex, idx2ij(this_idx + 1), 0).y;
        val = texelFetch(value_tex, idx2ij(this_src), 0).y;
        run = right_src > this_src ? uint(right_src - this_src) : uint(width * height - this_src);
        frag_color = run & uint(0xff);
    } else {  // first btye of either double or single size
        val = texelFetch(value_tex, idx2ij(this_src), 0).x;
        frag_color |= val << 4;
        if ((val == uint(0)) || (val == uint(15))) { // double, next rle is -1
            right_src = texelFetch(rle_tex, idx2ij(this_idx + 2), 0).y;
            run = right_src > this_src ? uint(right_src - this_src) : uint(width * height - this_src);
            frag_color |= (run >> 8) & uint(0x0f);
        } else { // single, next rle is valid
            right_src = texelFetch(rle_tex, idx2ij(this_idx + 1), 0).y;
            run = right_src > this_src ? uint(right_src - this_src) : uint(width * height - this_src);
            frag_color |= run & uint(0x0f);
        }
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

int ij2idx(ivec2 ij){
    return (height - ij.y - 1) * width + ij.x;
    // return ij.y * width + ij.x;
}

ivec2 idx2ij(int idx){
    return ivec2(idx % width, height - idx / width - 1);
    // return ivec2(idx % width, idx / width);
}

void main(){
    ivec2 ij = ivec2(gl_FragCoord.xy);
    uint val = texelFetch(value_tex, ij, 0).x;
    ivec2 rle = texelFetch(rle_tex, ij, 0).xy;
    int source_idx = rle.y;
    ivec2 source_ij = idx2ij(source_idx);
    uint source_val = texelFetch(value_tex, source_ij, 0).x;
    uint out_byte = texelFetch(out_tex, ij, 0).x;
    frag_color = vec4(
        float(rle.x) / 10000.,
        0., 0.,
        // float(source_val) / 15.,
        // float(rle.y != -1),
        1.
    );
}`;

/*
uint   uint8  texture0 value
uivec2 uint16 texture1 cumsum/idx swap-pair
uint   uint8  texture2 output
*/

var rle_texture_in = null;
var rle_texture_out = null;
var rle_program = null;

function swap_textures(){
    [rle_texture_in, rle_texture_out] = [rle_texture_out, rle_texture_in];
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
}

function run_step(step, n=1){
    gl.uniform1i(gl.getUniformLocation(rle_program, 'step'), step);
    for (let i = 0; i < n; i++){
        gl.uniform1i(gl.getUniformLocation(rle_program, 'i'), i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        swap_textures();
    }
}


function main(){

    // setup gl
    let canvas = document.getElementById('canvas');
    width = canvas.width;
    height = canvas.height;
    n_sum = Math.ceil(Math.log2(width * height))

    gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true});
    gl.getExtension("OES_texture_float_linear");
    gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("EXT_float_blend");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.disable(gl.DITHER);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // compile programs
    let vs = compile_shader(vs_src, gl.VERTEX_SHADER);
    let value_program = link_program(vs, compile_shader(value_src, gl.FRAGMENT_SHADER));
    rle_program = link_program(vs, compile_shader(rle_src, gl.FRAGMENT_SHADER));
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
    rle_texture_in = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32I, width, height, 0, gl.RG_INTEGER, gl.INT, 
        new Int32Array(Array(width * height * 2).fill(-1).flat()));
    rle_texture_out = gl.createTexture();
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
    let depthbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    
    // render to value texture
    gl.useProgram(value_program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, value_texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // {
    //     // save value for debug
    //     let debug = new Uint8Array(width * height);
    //     gl.readPixels(0, 0, width, height, gl.RED_INTEGER, gl.UNSIGNED_BYTE, debug, 0);
    //     let link = document.getElementById('value-download');
    //     link.href = window.URL.createObjectURL(new Blob([debug], {type: 'application/octet-stream'}));
    //     link.download = 'values.bin';
    // }
    
    // find repeats
    gl.useProgram(rle_program);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, rle_texture_in);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rle_texture_out, 0);
    run_step(0);
    
    // limited cumsum to find run starts
    run_step(1, n_sum);

    // prepare to count repeats
    run_step(2);

    // cumsum to count repeats (to get moves left)
    run_step(4, n_sum);

    // read last pixel to get number of repeats
    swap_textures();
    repeat_count = new Int32Array(2);
    gl.readPixels(width - 1, 0, 1, 1, gl.RG_INTEGER, gl.INT, repeat_count, 0);
    swap_textures();

    // gather left
    run_step(5, n_sum);

    // prepare to count doubles
    run_step(3);

    // cumsum to count doubles (to get moves right)
    run_step(4, n_sum);

    // read last pixel to get number of doubles
    swap_textures();
    double_count = new Int32Array(2);
    gl.finish();
    gl.readPixels(width - 1, 0, 1, 1, gl.RG_INTEGER, gl.INT, double_count, 0);
    swap_textures();

    // gather right
    run_step(6, n_sum);

    // {
    //     // save result for debug
    //     swap_textures();
    //     let debug = new Int32Array(width * height * 2);
    //     gl.readPixels(0, 0, width, height, gl.RG_INTEGER, gl.INT, debug, 0);
    //     let link = document.getElementById('rle-download');
    //     link.href = window.URL.createObjectURL(new Blob([debug], {type: 'application/octet-stream'}));
    //     link.download = 'debug_out.bin';
    //     swap_textures();
    // }

    // render to output
    gl.useProgram(output_program);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out_texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // download buffer from gpu
    n_bytes = width * height - repeat_count[0] + double_count[0] + 2;
    n_rows = Math.ceil(n_bytes / width);
    let raw_buffer = new Uint8Array(width * n_rows);
    gl.readPixels(0, height - n_rows, width, n_rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, raw_buffer, 0);
    function reverse(i){
        step = raw_buffer.length - Math.floor(i / width) * width - 1;
    }
    let reverse_buffer = Uint8Array.from(
        Array(raw_buffer.length).keys(), 
        (i) => raw_buffer[width * (
            Math.floor(raw_buffer.length / width) - Math.floor(i / width) - 1
        ) + i % width]
    );
    let blob = new Blob([reverse_buffer.slice(0, n_bytes)], {type: 'application/octet-stream'});
    let link = document.getElementById('download');
    link.href = window.URL.createObjectURL(blob);
    link.download = 'rle_output.bin';

    // render to canvas
    gl.useProgram(canvas_program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

}
