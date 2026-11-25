#pragma OPENCL FP_CONTRACT OFF
__kernel void attolang_saxpy_v1(
    const float scale, __global const float* x,
    __global const float* y, __global float* out, const ulong n) {
    const ulong i = get_global_id(0);
    if (i >= n) return;
    out[i] = scale * x[i] + y[i];
}
