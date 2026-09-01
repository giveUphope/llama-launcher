# llama-server 启动参数对照文档

> 来源：捆绑二进制 ".\llama-b10734-bin-win-vulkan-x64\llama-server.exe --help"
> 用途：对照当前启动器已支持参数，识别可新增/调整项

## 当前启动器已支持参数

当前参数定义位于 [packages/shared/src/params/definitions.ts](../../packages/shared/src/params/definitions.ts)。

## common params

| 参数 | 说明 | 状态 |
|------|------|------|
| `-h`, `--help`, `--usage` | print usage and exit | ⬜ 未支持 |
| `--version` | show version and build info | ⬜ 未支持 |
| `-cl`, `--cache-list` | show list of models in cache | ⬜ 未支持 |
| `--completion-bash` | print source-able bash completion script for llama.cpp | ⬜ 未支持 |
| `-t`, `--threads` | number of CPU threads to use during generation (default: -1) (env: LLAMA_ARG_THREADS) | ✅ 已支持 |
| `-tb`, `--threads-batch` | number of threads to use during batch and prompt processing (default: same as --threads) | ⬜ 未支持 |
| `-C`, `--cpu-mask` | CPU affinity mask: arbitrarily long hex. Complements cpu-range (default: "") | ⬜ 未支持 |
| `-Cr`, `--cpu-range` | lo-hi                range of CPUs for affinity. Complements --cpu-mask | ⬜ 未支持 |
| `--cpu-strict` | <0\|1>                      use strict CPU placement (default: 0) | ⬜ 未支持 |
| `--prio` | set process/thread priority : low(-1), normal(0), medium(1), high(2), realtime(3) (default: 0) | ⬜ 未支持 |
| `--poll` | <0...100>                        use polling level to wait for work (0 - no polling, default: 50) | ⬜ 未支持 |
| `-Cb`, `--cpu-mask-batch` | CPU affinity mask: arbitrarily long hex. Complements cpu-range-batch (default: same as --cpu-mask) | ⬜ 未支持 |
| `-Crb`, `--cpu-range-batch` | lo-hi          ranges of CPUs for affinity. Complements --cpu-mask-batch | ⬜ 未支持 |
| `--cpu-strict-batch` | <0\|1>                use strict CPU placement (default: same as --cpu-strict) | ⬜ 未支持 |
| `--prio-batch` | set process/thread priority : 0-normal, 1-medium, 2-high, 3-realtime (default: 0) | ⬜ 未支持 |
| `--poll-batch` | <0\|1>                      use polling to wait for work (default: same as --poll) | ⬜ 未支持 |
| `-c`, `--ctx-size` | size of the prompt context (default: 0, 0 = loaded from model) (env: LLAMA_ARG_CTX_SIZE) | ✅ 已支持 |
| `-n`, `--predict`, `--n-predict` | number of tokens to predict (default: -1, -1 = infinity) (env: LLAMA_ARG_N_PREDICT) | ⬜ 未支持 |
| `-b`, `--batch-size` | logical maximum batch size (default: 2048) (env: LLAMA_ARG_BATCH) | ✅ 已支持 |
| `-ub`, `--ubatch-size` | physical maximum batch size (default: 512) (env: LLAMA_ARG_UBATCH) | ✅ 已支持 |
| `--keep` | number of tokens to keep from the initial prompt (default: 0, -1 = all) | ⬜ 未支持 |
| `--swa-full` | use full-size SWA cache (default: false) [(more info)](https://github.com/ggml-org/llama.cpp/pull/13194#issuecomment-2868343055) (env: LLAMA_ARG_SWA_FULL) | ⬜ 未支持 |
| `-fa`, `--flash-attn` | [on\|off\|auto]       set Flash Attention use ('on', 'off', or 'auto', default: 'auto') (env: LLAMA_ARG_FLASH_ATTN) | ✅ 已支持 |
| `--perf`, `--no-perf` | whether to enable internal libllama performance timings (default: false) (env: LLAMA_ARG_PERF) | ⬜ 未支持 |
| `-e`, `--escape`, `--no-escape` | whether to process escapes sequences (\n, \r, \t, \', \", \\) (default: true) | ⬜ 未支持 |
| `--rope-scaling` | {none,linear,yarn}       RoPE frequency scaling method, defaults to linear unless specified by the model (env: LLAMA_ARG_ROPE_SCALING_TYPE) | ⬜ 未支持 |
| `--rope-scale` | RoPE context scaling factor, expands context by a factor of N (env: LLAMA_ARG_ROPE_SCALE) | ⬜ 未支持 |
| `--rope-freq-base` | RoPE base frequency, used by NTK-aware scaling (default: loaded from model) (env: LLAMA_ARG_ROPE_FREQ_BASE) | ⬜ 未支持 |
| `--rope-freq-scale` | RoPE frequency scaling factor, expands context by a factor of 1/N (env: LLAMA_ARG_ROPE_FREQ_SCALE) | ⬜ 未支持 |
| `--yarn-orig-ctx` | YaRN: original context size of model (default: 0 = model training context size) (env: LLAMA_ARG_YARN_ORIG_CTX) | ⬜ 未支持 |
| `--yarn-ext-factor` | YaRN: extrapolation mix factor (default: -1.00, 0.0 = full interpolation) (env: LLAMA_ARG_YARN_EXT_FACTOR) | ⬜ 未支持 |
| `--yarn-attn-factor` | YaRN: scale sqrt(t) or attention magnitude (default: -1.00) (env: LLAMA_ARG_YARN_ATTN_FACTOR) | ⬜ 未支持 |
| `--yarn-beta-slow` | YaRN: high correction dim or alpha (default: -1.00) (env: LLAMA_ARG_YARN_BETA_SLOW) | ⬜ 未支持 |
| `--yarn-beta-fast` | YaRN: low correction dim or beta (default: -1.00) (env: LLAMA_ARG_YARN_BETA_FAST) | ⬜ 未支持 |
| `-kvo`, `--kv-offload`, `-nkvo`, `--no-kv-offload` | whether to enable KV cache offloading (default: enabled) (env: LLAMA_ARG_KV_OFFLOAD) | ✅ 已支持 |
| `--repack`, `-nr`, `--no-repack` | whether to enable weight repacking (default: enabled) (env: LLAMA_ARG_REPACK) | ⬜ 未支持 |
| `--no-host` | bypass host buffer allowing extra buffers to be used (env: LLAMA_ARG_NO_HOST) | ⬜ 未支持 |
| `-ctk`, `--cache-type-k` | KV cache data type for K allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1 (default: f16) (env: LLAMA_ARG_CACHE_TYPE_K) | ✅ 已支持 |
| `-ctv`, `--cache-type-v` | KV cache data type for V allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1 (default: f16) (env: LLAMA_ARG_CACHE_TYPE_V) | ✅ 已支持 |
| `-dt`, `--defrag-thold` | KV cache defragmentation threshold (DEPRECATED) (env: LLAMA_ARG_DEFRAG_THOLD) | ⬜ 未支持 |
| `--rpc` | comma-separated list of RPC servers (host:port) (env: LLAMA_ARG_RPC) | ⬜ 未支持 |
| `--mlock` | in favor of `--load-mode`: force system to keep model in RAM rather than swapping or compressing (env: LLAMA_ARG_MLOCK) | ⬜ 未支持 |
| `--mmap`, `--no-mmap` | in favor of `--load-mode`: whether to memory-map model. (if mmap disabled, slower load but may reduce pageouts if not using mlock) (env: LLAMA_ARG_MMAP) | ⬜ 未支持 |
| `-dio`, `--direct-io`, `-ndio`, `--no-direct-io` | in favor of `--load-mode`: use DirectIO if available (env: LLAMA_ARG_DIO) | ⬜ 未支持 |
| `-lm`, `--load-mode` | model loading mode (default: auto) - auto: mmap, unless a device does not support it - none: no special loading mode - mmap: memory-map model (if mmap disabled, slower load but may reduce pageouts if not using mlock) - mlock: force system to keep model in RAM rather than swapping or compressing - mmap+mlock: mmap + force system to keep model in RAM rather than swapping or compressing - dio: use DirectIO if available | ✅ 已支持 |
| `-lzm`, `--lazy-mode` | on-demand reading of certain tensors, for example per-layer embeddings (default: auto) - on: read the rows of such tensors from disk on demand instead of keeping them resident (requires mmap) - auto: on, but only for tensors larger than 4 GiB - off: always keep them resident (env: LLAMA_ARG_LAZY_MODE) | ✅ 已支持 |
| `--numa` | attempt optimizations that help on some NUMA systems - distribute: spread execution evenly over all nodes - isolate: only spawn threads on CPUs on the node that execution started on - numactl: use the CPU map provided by numactl if run without this previously, it is recommended to drop the system page cache before using this see https://github.com/ggml-org/llama.cpp/issues/1437 (env: LLAMA_ARG_NUMA) | ⬜ 未支持 |
| `-dev`, `--device` | <dev1,dev2,..>          comma-separated list of devices to use for offloading (none = don't offload) use --list-devices to see a list of available devices (env: LLAMA_ARG_DEVICE) | ⬜ 未支持 |
| `--list-devices` | print list of available devices and exit | ⬜ 未支持 |
| `-ot`, `--override-tensor` | <tensor name pattern>=<buffer type>,... override tensor buffer type (env: LLAMA_ARG_OVERRIDE_TENSOR) | ⬜ 未支持 |
| `-cmoe`, `--cpu-moe` | keep all Mixture of Experts (MoE) weights in the CPU (env: LLAMA_ARG_CPU_MOE) | ⬜ 未支持 |
| `-ncmoe`, `--n-cpu-moe` | keep the Mixture of Experts (MoE) weights of the first N layers in the CPU (env: LLAMA_ARG_N_CPU_MOE) | ✅ 已支持 |
| `-ncffn`, `--n-cpu-ffn` | keep the dense FFN weights of the first N layers in the CPU (dense models; for MoE expert weights use --n-cpu-moe) (env: LLAMA_ARG_N_CPU_FFN) | ✅ 已支持 |
| `-ngl`, `--gpu-layers`, `--n-gpu-layers` | max. number of layers to store in VRAM, either an exact number, 'auto', or 'all' (default: auto) (env: LLAMA_ARG_N_GPU_LAYERS) | ✅ 已支持 |
| `-sm`, `--split-mode` | {none,layer,row,tensor} how to split the model across multiple GPUs, one of: - none: use one GPU only - layer (default): split layers and KV across GPUs (pipelined) - row: split weight across GPUs by rows (parallelized) - tensor: split weights and KV across GPUs (parallelized, EXPERIMENTAL) (env: LLAMA_ARG_SPLIT_MODE) | ⬜ 未支持 |
| `-ts`, `--tensor-split` | N0,N1,N2,...      fraction of the model to offload to each GPU, comma-separated list of proportions, e.g. 3,1 (env: LLAMA_ARG_TENSOR_SPLIT) | ⬜ 未支持 |
| `-mg`, `--main-gpu` | the GPU to use for the model (with split-mode = none), or for intermediate results and KV (with split-mode = row) (default: 0) (env: LLAMA_ARG_MAIN_GPU) | ⬜ 未支持 |
| `-fit`, `--fit` | [on\|off]                   whether to adjust unset arguments to fit in device memory ('on' or 'off', default: 'on') (env: LLAMA_ARG_FIT) | ✅ 已支持 |
| `-fitt`, `--fit-target` | MiB0,MiB1,MiB2,... target margin per device for --fit, comma-separated list of values, single value is broadcast across all devices, default: 1024 (env: LLAMA_ARG_FIT_TARGET) | ⬜ 未支持 |
| `-fitc`, `--fit-ctx` | minimum ctx size that can be set by --fit option, default: 4096 (env: LLAMA_ARG_FIT_CTX) | ⬜ 未支持 |
| `--check-tensors` | check model tensor data for invalid values (default: false) | ⬜ 未支持 |
| `--override-kv` | KEY=TYPE:VALUE,...        advanced option to override model metadata by key. to specify multiple overrides, either use comma-separated values. types: int, float, bool, str. example: --override-kv tokenizer.ggml.add_bos_token=bool:false,tokenizer.ggml.add_eos_token=bool:false | ⬜ 未支持 |
| `--op-offload`, `--no-op-offload` | whether to offload host tensor operations to device (default: true) | ⬜ 未支持 |
| `--lora` | path to LoRA adapter (use comma-separated values to load multiple adapters) | ⬜ 未支持 |
| `--lora-scaled` | FNAME:SCALE,...           path to LoRA adapter with user defined scaling (format: FNAME:SCALE,...) note: use comma-separated values | ⬜ 未支持 |
| `--control-vector` | add a control vector note: use comma-separated values to add multiple control vectors | ⬜ 未支持 |
| `--control-vector-scaled` | FNAME:SCALE,... add a control vector with user defined scaling SCALE note: use comma-separated values (format: FNAME:SCALE,...) | ⬜ 未支持 |
| `--control-vector-layer-range` | END layer range to apply the control vector(s) to, start and end inclusive | ⬜ 未支持 |
| `-m`, `--model` | model path to load (env: LLAMA_ARG_MODEL) | ⬜ 未支持 |
| `-mu`, `--model-url` | model download url (default: unused) (env: LLAMA_ARG_MODEL_URL) | ⬜ 未支持 |
| `-dr`, `--docker-repo` | [<repo>/]<model>[:quant] Docker Hub model repository. repo is optional, default to ai/. quant is optional, default to :latest. example: gemma3 (default: unused) (env: LLAMA_ARG_DOCKER_REPO) | ⬜ 未支持 |
| `-hf`, `-hfr`, `--hf-repo` | <user>/<model>[:quant] Hugging Face model repository; quant is optional, case-insensitive, default to Q4_K_M, or falls back to the first file in the repo if Q4_K_M doesn't exist. mmproj is also downloaded automatically if available. to disable, add | ⬜ 未支持 |
| `--no-mmproj` | example: ggml-org/GLM-4.7-Flash-GGUF:Q4_K_M (default: unused) (env: LLAMA_ARG_HF_REPO) | ⬜ 未支持 |
| `-hff`, `--hf-file` | Hugging Face model file. If specified, it will override the quant in | ⬜ 未支持 |
| `--hf-repo` | (default: unused) (env: LLAMA_ARG_HF_FILE) | ⬜ 未支持 |
| `-hft`, `--hf-token` | Hugging Face access token (default: value from HF_TOKEN environment variable) (env: HF_TOKEN) | ⬜ 未支持 |
| `--log-disable` | Log disable | ⬜ 未支持 |
| `--log-file` | Log to file (env: LLAMA_ARG_LOG_FILE) | ⬜ 未支持 |
| `--log-colors` | [on\|off\|auto]              Set colored logging ('on', 'off', or 'auto', default: 'auto') 'auto' enables colors when output is to a terminal (env: LLAMA_ARG_LOG_COLORS) | ⬜ 未支持 |
| `-v`, `--verbose`, `--log-verbose` | Set verbosity level to infinity (i.e. log all messages, useful for debugging) | ⬜ 未支持 |
| `--offline` | Offline mode: forces use of cache, prevents network access (env: LLAMA_ARG_OFFLINE) | ⬜ 未支持 |
| `-lv`, `--verbosity`, `--log-verbosity` | Set the verbosity threshold. Messages with a higher verbosity will be ignored. Values: - 0: generic output - 1: error - 2: warning - 3: info - 4: trace (more info) - 5: debug (default: 3) | ⬜ 未支持 |
| `--log-prefix`, `--no-log-prefix` | Enable prefix in log messages (env: LLAMA_ARG_LOG_PREFIX) | ⬜ 未支持 |
| `--log-timestamps`, `--no-log-timestamps` | Enable timestamps in log messages (env: LLAMA_ARG_LOG_TIMESTAMPS) | ⬜ 未支持 |
| `--spec-draft-type-k`, `-ctkd`, `--cache-type-k-draft` | KV cache data type for K for the draft model allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1 (default: f16) (env: LLAMA_ARG_SPEC_DRAFT_CACHE_TYPE_K) | ✅ 已支持 |
| `--spec-draft-type-v`, `-ctvd`, `--cache-type-v-draft` | KV cache data type for V for the draft model allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1 (default: f16) (env: LLAMA_ARG_SPEC_DRAFT_CACHE_TYPE_V) | ✅ 已支持 |

## sampling params

| 参数 | 说明 | 状态 |
|------|------|------|
| `--samplers` | samplers that will be used for generation in the order, separated by ';' (default: penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature) | ⬜ 未支持 |
| `-s`, `--seed` | RNG seed (default: -1, use random seed for -1) | ✅ 已支持 |
| `--sampler-seq`, `--sampling-seq` | simplified sequence for samplers that will be used (default: edskypmxt) | ⬜ 未支持 |
| `--ignore-eos` | ignore end of stream token and continue generating (implies | ⬜ 未支持 |
| `--logit-bias` | EOS-inf) | ⬜ 未支持 |
| `--temp`, `--temperature` | temperature (default: 0.80) | ✅ 已支持 |
| `--top-k` | top-k sampling (default: 40, 0 = disabled) (env: LLAMA_ARG_TOP_K) | ✅ 已支持 |
| `--top-p` | top-p sampling (default: 0.95, 1.0 = disabled) | ✅ 已支持 |
| `--min-p` | min-p sampling (default: 0.05, 0.0 = disabled) | ✅ 已支持 |
| `--top-nsigma`, `--top-n-sigma` | top-n-sigma sampling (default: -1.00, -1.0 = disabled) | ⬜ 未支持 |
| `--xtc-probability` | xtc probability (default: 0.00, 0.0 = disabled) | ⬜ 未支持 |
| `--xtc-threshold` | xtc threshold (default: 0.10, 1.0 = disabled) | ⬜ 未支持 |
| `--typical`, `--typical-p` | locally typical sampling, parameter p (default: 1.00, 1.0 = disabled) | ⬜ 未支持 |
| `--repeat-last-n` | last n tokens to consider for penalize (default: 64, 0 = disabled) | ⬜ 未支持 |
| `--repeat-penalty` | penalize repeat sequence of tokens (default: 1.00, 1.0 = disabled) | ✅ 已支持 |
| `--presence-penalty` | repeat alpha presence penalty (default: 0.00, 0.0 = disabled) | ✅ 已支持 |
| `--frequency-penalty` | repeat alpha frequency penalty (default: 0.00, 0.0 = disabled) | ⬜ 未支持 |
| `--dry-multiplier` | set DRY sampling multiplier (default: 0.00, 0.0 = disabled) | ⬜ 未支持 |
| `--dry-base` | set DRY sampling base value (default: 1.75) | ⬜ 未支持 |
| `--dry-allowed-length` | set allowed length for DRY sampling (default: 2) | ⬜ 未支持 |
| `--dry-penalty-last-n` | set DRY penalty for the last n tokens (default: 64, 0 = disable) | ⬜ 未支持 |
| `--dry-sequence-breaker` | add sequence breaker for DRY sampling, clearing out default breakers ('\n', ':', '"', '*') in the process; use "none" to not use any sequence breakers | ⬜ 未支持 |
| `--adaptive-target` | adaptive-p: select tokens near this probability (valid range 0.0 to 1.0; negative = disabled) (default: -1.00) [(more info)](https://github.com/ggml-org/llama.cpp/pull/17927) | ⬜ 未支持 |
| `--adaptive-decay` | adaptive-p: decay rate for target adaptation over time. lower values are more reactive, higher values are more stable. (valid range 0.0 to 0.99) (default: 0.90) | ⬜ 未支持 |
| `--dynatemp-range` | dynamic temperature range (default: 0.00, 0.0 = disabled) | ⬜ 未支持 |
| `--dynatemp-exp` | dynamic temperature exponent (default: 1.00) | ⬜ 未支持 |
| `--mirostat` | use Mirostat sampling. Top K, Nucleus and Locally Typical samplers are ignored if used. (default: 0, 0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0) | ⬜ 未支持 |
| `--mirostat-lr` | Mirostat learning rate, parameter eta (default: 0.10) | ⬜ 未支持 |
| `--mirostat-ent` | Mirostat target entropy, parameter tau (default: 5.00) | ⬜ 未支持 |
| `-l`, `--logit-bias` | TOKEN_ID(+/-)BIAS   modifies the likelihood of token appearing in the completion, i.e. `--logit-bias 15043+1` to increase likelihood of token ' Hello', or `--logit-bias 15043-1` to decrease likelihood of token ' Hello' | ⬜ 未支持 |
| `--grammar` | BNF-like grammar to constrain generations (see samples in grammars/ dir) | ⬜ 未支持 |
| `--grammar-file` | file to read grammar from | ⬜ 未支持 |
| `-j`, `--json-schema` | JSON schema to constrain generations (https://json-schema.org/), e.g. `{}` for any JSON object For schemas w/ external $refs, use --grammar + example/json_schema_to_grammar.py instead | ⬜ 未支持 |
| `-jf`, `--json-schema-file` | File containing a JSON schema to constrain generations (https://json-schema.org/), e.g. `{}` for any JSON object For schemas w/ external $refs, use --grammar + example/json_schema_to_grammar.py instead | ⬜ 未支持 |
| `-bs`, `--backend-sampling` | enable backend sampling (experimental) (default: disabled) (env: LLAMA_ARG_BACKEND_SAMPLING) | ⬜ 未支持 |

## speculative params

| 参数 | 说明 | 状态 |
|------|------|------|
| `--spec-draft-hf`, `-hfd`, `-hfrd`, `--hf-repo-draft` | <user>/<model>[:quant] Same as --hf-repo, but for the draft model (default: unused) (env: LLAMA_ARG_SPEC_DRAFT_HF_REPO) | ⬜ 未支持 |
| `--spec-draft-threads`, `-td`, `--threads-draft` | number of threads to use during generation (default: same as | ⬜ 未支持 |
| `--spec-draft-threads-batch`, `-tbd`, `--threads-batch-draft` | number of threads to use during batch and prompt processing (default: same as --threads-draft) | ⬜ 未支持 |
| `--spec-draft-cpu-mask`, `-Cd`, `--cpu-mask-draft` | Draft model CPU affinity mask. Complements cpu-range-draft (default: same as --cpu-mask) | ⬜ 未支持 |
| `--spec-draft-cpu-range`, `-Crd`, `--cpu-range-draft` | lo-hi Ranges of CPUs for affinity. Complements --cpu-mask-draft | ⬜ 未支持 |
| `--spec-draft-cpu-strict`, `--cpu-strict-draft` | <0\|1> Use strict CPU placement for draft model (default: same as | ⬜ 未支持 |
| `--spec-draft-prio`, `--prio-draft` | set draft process/thread priority : 0-normal, 1-medium, 2-high, 3-realtime (default: 0) | ⬜ 未支持 |
| `--spec-draft-poll`, `--poll-draft` | <0\|1>   Use polling to wait for draft model work (default: same as --poll) | ⬜ 未支持 |
| `--spec-draft-cpu-mask-batch`, `-Cbd`, `--cpu-mask-batch-draft` | Draft model CPU affinity mask. Complements cpu-range-draft (default: same as --cpu-mask) | ⬜ 未支持 |
| `--spec-draft-cpu-strict-batch`, `--cpu-strict-batch-draft` | <0\|1> Use strict CPU placement for draft model (default: --cpu-strict-draft) | ⬜ 未支持 |
| `--spec-draft-prio-batch`, `--prio-batch-draft` | set draft process/thread priority : 0-normal, 1-medium, 2-high, 3-realtime (default: 0) | ⬜ 未支持 |
| `--spec-draft-poll-batch`, `--poll-batch-draft` | <0\|1> Use polling to wait for draft model work (default: --poll-draft) | ⬜ 未支持 |
| `--spec-draft-override-tensor`, `-otd`, `--override-tensor-draft` | <tensor name pattern>=<buffer type>,... override tensor buffer type for draft model | ⬜ 未支持 |
| `--spec-draft-cpu-moe`, `-cmoed`, `--cpu-moe-draft` | keep all Mixture of Experts (MoE) weights in the CPU for the draft model (env: LLAMA_ARG_SPEC_DRAFT_CPU_MOE) | ⬜ 未支持 |
| `--spec-draft-n-cpu-moe`, `--spec-draft-ncmoe`, `-ncmoed`, `--n-cpu-moe-draft` | keep the Mixture of Experts (MoE) weights of the first N layers in the CPU for the draft model (env: LLAMA_ARG_SPEC_DRAFT_N_CPU_MOE) | ⬜ 未支持 |
| `--spec-draft-n-max` | number of tokens to draft for speculative decoding (default: 3) (env: LLAMA_ARG_SPEC_DRAFT_N_MAX) | ✅ 已支持 |
| `--spec-draft-n-min` | minimum number of draft tokens to use for speculative decoding (default: 0) (env: LLAMA_ARG_SPEC_DRAFT_N_MIN) | ✅ 已支持 |
| `--spec-synth-len` | target mean synthetic acceptance length, including the target token (benchmarking only) (env: LLAMA_ARG_SPEC_SYNTH_LEN) | ✅ 已支持 |
| `--spec-synth-rates` | P0,P1,...            comma-separated unconditional per-position synthetic acceptance probabilities (benchmarking only) (env: LLAMA_ARG_SPEC_SYNTH_RATES) | ✅ 已支持 |
| `--spec-draft-p-split`, `--draft-p-split` | speculative decoding split probability (default: 0.10) (env: LLAMA_ARG_SPEC_DRAFT_P_SPLIT) | ⬜ 未支持 |
| `--spec-draft-p-min`, `--draft-p-min` | minimum speculative decoding probability (greedy) (default: 0.00) (env: LLAMA_ARG_SPEC_DRAFT_P_MIN) | ⬜ 未支持 |
| `--spec-draft-backend-sampling`, `--no-spec-draft-backend-sampling` | offload draft sampling to the backend (default: enabled) (env: LLAMA_ARG_SPEC_DRAFT_BACKEND_SAMPLING) | ⬜ 未支持 |
| `--spec-draft-device`, `-devd`, `--device-draft` | <dev1,dev2,..> comma-separated list of devices to use for offloading the draft model (none = don't offload) use --list-devices to see a list of available devices | ⬜ 未支持 |
| `--spec-draft-ngl`, `-ngld`, `--gpu-layers-draft`, `--n-gpu-layers-draft` | max. number of draft model layers to store in VRAM, either an exact number, 'auto', or 'all' (default: auto) (env: LLAMA_ARG_N_GPU_LAYERS_DRAFT) | ✅ 已支持 |
| `--spec-draft-model`, `-md`, `--model-draft` | draft model for speculative decoding (default: unused) (env: LLAMA_ARG_SPEC_DRAFT_MODEL) | ✅ 已支持 |
| `--spec-type` | none,draft-simple,draft-eagle3,draft-mtp,draft-dflash,draft-dspark,ngram-simple,ngram-map-k,ngram-map-k4v,ngram-mod,ngram-cache comma-separated list of types of speculative decoding to use (default: none) | ✅ 已支持 |
| `--spec-ngram-mod-n-min` | minimum number of ngram tokens to use for ngram-based speculative decoding (default: 48) | ⬜ 未支持 |
| `--spec-ngram-mod-n-max` | maximum number of ngram tokens to use for ngram-based speculative decoding (default: 64) | ⬜ 未支持 |
| `--spec-ngram-mod-n-match` | ngram-mod lookup length (default: 24) | ⬜ 未支持 |
| `--spec-ngram-simple-size-n` | ngram size N for ngram-simple speculative decoding, length of lookup n-gram (default: 12) | ⬜ 未支持 |
| `--spec-ngram-simple-size-m` | ngram size M for ngram-simple speculative decoding, length of draft m-gram (default: 48) | ⬜ 未支持 |
| `--spec-ngram-simple-min-hits` | minimum hits for ngram-simple speculative decoding (default: 1) | ⬜ 未支持 |
| `--spec-ngram-map-k-size-n` | ngram size N for ngram-map-k speculative decoding, length of lookup n-gram (default: 12) | ⬜ 未支持 |
| `--spec-ngram-map-k-size-m` | ngram size M for ngram-map-k speculative decoding, length of draft m-gram (default: 48) | ⬜ 未支持 |
| `--spec-ngram-map-k-min-hits` | minimum hits for ngram-map-k speculative decoding (default: 1) | ⬜ 未支持 |
| `--spec-ngram-map-k4v-size-n` | ngram size N for ngram-map-k4v speculative decoding, length of lookup n-gram (default: 12) | ⬜ 未支持 |
| `--spec-ngram-map-k4v-size-m` | ngram size M for ngram-map-k4v speculative decoding, length of draft m-gram (default: 48) | ⬜ 未支持 |
| `--spec-ngram-map-k4v-min-hits` | minimum hits for ngram-map-k4v speculative decoding (default: 1) | ⬜ 未支持 |
| `--draft`, `--draft-n`, `--draft-max` | the argument has been removed. use --spec-draft-n-max or | ⬜ 未支持 |
| `--spec-ngram-mod-n-max` | (env: LLAMA_ARG_DRAFT_MAX) | ⬜ 未支持 |
| `--draft-min`, `--draft-n-min` | the argument has been removed. use --spec-draft-n-min or | ⬜ 未支持 |
| `--spec-ngram-mod-n-min` | (env: LLAMA_ARG_DRAFT_MIN) | ⬜ 未支持 |
| `--spec-ngram-size-n` | the argument has been removed. use the respective | ⬜ 未支持 |
| `--spec-ngram-size-m` | the argument has been removed. use the respective | ⬜ 未支持 |
| `--spec-ngram-min-hits` | the argument has been removed. use the respective | ⬜ 未支持 |

## example-specific params

| 参数 | 说明 | 状态 |
|------|------|------|
| `-lcs`, `--lookup-cache-static` | path to static lookup cache to use for lookup decoding (not updated by generation) | ⬜ 未支持 |
| `-lcd`, `--lookup-cache-dynamic` | path to dynamic lookup cache to use for lookup decoding (updated by generation) | ⬜ 未支持 |
| `--kv-unified-per-slot` | context limit per parallel slot (default: unset, behavior unchanged). when set without -c/--ctx-size, the shared KV pool is sized to n_parallel*N (env: LLAMA_ARG_KV_UNIFIED_PER_SLOT) | ✅ 已支持 |
| `-ctxcp`, `--ctx-checkpoints`, `--swa-checkpoints` | max number of context checkpoints to create per slot (default: 32)[(more info)](https://github.com/ggml-org/llama.cpp/pull/15293) (env: LLAMA_ARG_CTX_CHECKPOINTS) | ⬜ 未支持 |
| `-cms`, `--checkpoint-min-step` | minimum spacing between context checkpoints in tokens (default: 8192, 0 = no minimum) (env: LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT) | ⬜ 未支持 |
| `-cram`, `--cache-ram` | set the maximum cache size in MiB (default: 8192, -1 - no limit, 0 - disable)[(more info)](https://github.com/ggml-org/llama.cpp/pull/16391) (env: LLAMA_ARG_CACHE_RAM) | ⬜ 未支持 |
| `-kvu`, `--kv-unified`, `-no-kvu`, `--no-kv-unified` | use single unified KV buffer shared across all sequences (default: enabled if number of slots is auto) (env: LLAMA_ARG_KV_UNIFIED) | ✅ 已支持 |
| `--cache-idle-slots`, `--no-cache-idle-slots` | save idle slots to the prompt cache on new task, and clear them when using unified KV (default: enabled, requires cache-ram) (env: LLAMA_ARG_CACHE_IDLE_SLOTS) | ⬜ 未支持 |
| `--context-shift`, `--no-context-shift` | whether to use context shift on infinite text generation (default: disabled) (env: LLAMA_ARG_CONTEXT_SHIFT) | ✅ 已支持 |
| `-r`, `--reverse-prompt` | halt generation at PROMPT, return control in interactive mode | ⬜ 未支持 |
| `-sp`, `--special` | special tokens output enabled (default: false) | ⬜ 未支持 |
| `--warmup`, `--no-warmup` | whether to perform warmup with an empty run (default: enabled) | ⬜ 未支持 |
| `--spm-infill` | use Suffix/Prefix/Middle pattern for infill (instead of Prefix/Suffix/Middle) as some models prefer this. (default: disabled) | ⬜ 未支持 |
| `--pooling` | {none,mean,cls,last,rank}     pooling type for embeddings, use model default if unspecified (env: LLAMA_ARG_POOLING) | ⬜ 未支持 |
| `-np`, `--parallel` | number of server slots (default: -1, -1 = auto) (env: LLAMA_ARG_N_PARALLEL) | ✅ 已支持 |
| `-cb`, `--cont-batching`, `-nocb`, `--no-cont-batching` | whether to enable continuous batching (a.k.a dynamic batching) (default: enabled) (env: LLAMA_ARG_CONT_BATCHING) | ✅ 已支持 |
| `-mm`, `--mmproj` | path to a multimodal projector file. see tools/mtmd/README.md note: if -hf is used, this argument can be omitted (env: LLAMA_ARG_MMPROJ) | ✅ 已支持 |
| `-mmu`, `--mmproj-url` | URL to a multimodal projector file. see tools/mtmd/README.md (env: LLAMA_ARG_MMPROJ_URL) | ⬜ 未支持 |
| `--mmproj-auto`, `--no-mmproj`, `--no-mmproj-auto` | whether to use multimodal projector file (if available), useful when using -hf (default: enabled) (env: LLAMA_ARG_MMPROJ_AUTO) | ⬜ 未支持 |
| `--mmproj-offload`, `--no-mmproj-offload` | whether to enable GPU offloading for multimodal projector (default: enabled) (env: LLAMA_ARG_MMPROJ_OFFLOAD) | ⬜ 未支持 |
| `-mmdev`, `--mmproj-device` | device to use for multimodal projector (none = don't offload, default: auto) use --list-devices to see a list of available devices (env: MTMD_BACKEND_DEVICE) | ✅ 已支持 |
| `--image-min-tokens` | minimum number of tokens each image can take, only used by vision models with dynamic resolution (default: read from model) (env: LLAMA_ARG_IMAGE_MIN_TOKENS) | ⬜ 未支持 |
| `--image-max-tokens` | maximum number of tokens each image can take, only used by vision models with dynamic resolution (default: read from model) (env: LLAMA_ARG_IMAGE_MAX_TOKENS) | ⬜ 未支持 |
| `--mtmd-batch-max-tokens` | maximum number of image tokens per batch when encoding images (default: 1024) (env: LLAMA_ARG_MTMD_BATCH_MAX_TOKENS) | ⬜ 未支持 |
| `--video-fps` | target video frame rate (default: 4.0) (env: LLAMA_ARG_VIDEO_FPS) | ✅ 已支持 |
| `--video-timestamp-interval` | interval in milliseconds between text timestamps (default: 5000) (env: LLAMA_ARG_VIDEO_TIMESTAMP_INTERVAL) | ✅ 已支持 |
| `--video-ffmpeg-dir` | path to the directory containing ffmpeg and ffprobe (default: search in PATH) (env: LLAMA_ARG_VIDEO_FFMPEG_DIR) | ✅ 已支持 |
| `-a`, `--alias` | set model name aliases, comma-separated (to be used by API) (env: LLAMA_ARG_ALIAS) | ✅ 已支持 |
| `--tags` | set model tags, comma-separated (informational, not used for routing) (env: LLAMA_ARG_TAGS) | ⬜ 未支持 |
| `--embd-normalize` | normalisation for embeddings (default: 2) (-1=none, 0=max absolute int16, 1=taxicab, 2=euclidean, >2=p-norm) | ⬜ 未支持 |
| `--host` | ip address to listen, or bind to an UNIX socket if the address ends with .sock (default: 127.0.0.1) (env: LLAMA_ARG_HOST) | ✅ 已支持 |
| `--port` | port to listen (default: 8080) (env: LLAMA_ARG_PORT) | ✅ 已支持 |
| `--reuse-port` | allow multiple sockets to bind to the same port (default: disabled) (env: LLAMA_ARG_REUSE_PORT) | ⬜ 未支持 |
| `--path` | path to serve static files from (default: ) (env: LLAMA_ARG_STATIC_PATH) | ⬜ 未支持 |
| `--cors-origins` | comma-separated list of allowed origins for CORS (default: *) if set to special value 'localhost', reflect the Origin header only if it is localhost (env: LLAMA_ARG_CORS_ORIGINS) | ⬜ 未支持 |
| `--cors-methods` | comma-separated list of allowed methods for CORS (default: GET, POST, DELETE, OPTIONS) (env: LLAMA_ARG_CORS_METHODS) | ⬜ 未支持 |
| `--cors-headers` | comma-separated list of allowed headers for CORS (default: *) (env: LLAMA_ARG_CORS_HEADERS) | ⬜ 未支持 |
| `--cors-credentials`, `--no-cors-credentials` | whether to allow credentials for CORS (default: enabled) note: if this is enabled and --cors-origins is set to * (default), the Origin header will be echoed back, and credentials will always be allowed (env: LLAMA_ARG_CORS_CREDENTIALS) | ⬜ 未支持 |
| `--api-prefix` | prefix path the server serves from, without the trailing slash (default: ) (env: LLAMA_ARG_API_PREFIX) | ⬜ 未支持 |
| `--ui-config`, `--webui-config` | JSON that provides default UI settings (overrides UI defaults) (env: LLAMA_ARG_UI_CONFIG) | ⬜ 未支持 |
| `--ui-config-file`, `--webui-config-file` | JSON file that provides default UI settings (overrides UI defaults) (env: LLAMA_ARG_UI_CONFIG_FILE) | ⬜ 未支持 |
| `--ui-mcp-proxy`, `--webui-mcp-proxy`, `--no-ui-mcp-proxy`, `--no-webui-mcp-proxy` | experimental: whether to enable MCP CORS proxy - do not enable in untrusted environments (default: disabled) (env: LLAMA_ARG_UI_MCP_PROXY) | ⬜ 未支持 |
| `--tools` | TOOL1,TOOL2,...                 experimental: whether to enable built-in tools for AI agents - do not enable in untrusted environments (default: no tools) specify "all" to enable all tools available tools: read_file, file_glob_search, grep_search, exec_shell_command, write_file, edit_file, get_info note: for security reasons, this will limit --cors-origins to localhost by default (env: LLAMA_ARG_TOOLS) | ⬜ 未支持 |
| `--tools-runtime` | experimental: run tools in a separate runtime environment (default: none, use host environment) available options: 'docker:<image>', 'podman:<image>': spin up a new container and reuse it for all invocations, clean up on server exit 'docker-container:<id>', 'podman-container:<id>': use an existing container by ID, won't stop on server exit 'ssh:<target>': run tools on a remote POSIX host over SSH, key-based auth and a trusted host key are required | ⬜ 未支持 |
| `--mcp-servers-config` | experimental: path to JSON file with MCP server definitions (Cursor-compatible format) - do not enable in untrusted environments (default: none) note: for security reasons, this will limit --cors-origins to localhost by default (env: LLAMA_ARG_MCP_SERVERS_CONFIG) | ⬜ 未支持 |
| `--mcp-servers-json` | experimental: inline JSON with MCP server definitions (Cursor-compatible format) - do not enable in untrusted environments (default: none) note: for security reasons, this will limit --cors-origins to localhost by default (env: LLAMA_ARG_MCP_SERVERS_JSON) | ⬜ 未支持 |
| `-ag`, `--agent`, `-no-ag`, `--no-agent` | whether to enable CORS proxy and all built-in tools - do not enable in untrusted environments (default: disabled) note: for security reasons, this will limit --cors-origins to localhost by default (env: LLAMA_ARG_AGENT) | ⬜ 未支持 |
| `--ui`, `--webui`, `--no-ui`, `--no-webui` | whether to enable the Web UI (default: enabled) (env: LLAMA_ARG_UI) | ✅ 已支持 |
| `--embedding`, `--embeddings` | restrict to only support embedding use case; use only with dedicated embedding models (default: disabled) (env: LLAMA_ARG_EMBEDDINGS) | ⬜ 未支持 |
| `--rerank`, `--reranking` | enable reranking endpoint on server (default: disabled) (env: LLAMA_ARG_RERANKING) | ⬜ 未支持 |
| `--api-key` | API key to use for authentication, multiple keys can be provided as a comma-separated list (default: none) (env: LLAMA_API_KEY) | ✅ 已支持 |
| `--api-key-file` | path to file containing API keys, one per line; lines starting with a hash are treated as comments (default: none) (env: LLAMA_ARG_API_KEY_FILE) | ⬜ 未支持 |
| `--ssl-key-file` | path to file a PEM-encoded SSL private key (env: LLAMA_ARG_SSL_KEY_FILE) | ⬜ 未支持 |
| `--ssl-cert-file` | path to file a PEM-encoded SSL certificate (env: LLAMA_ARG_SSL_CERT_FILE) | ⬜ 未支持 |
| `--chat-template-kwargs` | sets additional params for the json template parser, must be a valid json object string, e.g. '{"key1":"value1","key2":"value2"}' (env: LLAMA_ARG_CHAT_TEMPLATE_KWARGS) | ⬜ 未支持 |
| `-to`, `--timeout` | server read/write timeout in seconds (default: 3600) (env: LLAMA_ARG_TIMEOUT) | ✅ 已支持 |
| `--sse-ping-interval` | server SSE ping interval in seconds (-1 = disabled, default: 30) (env: LLAMA_ARG_SSE_PING_INTERVAL) | ⬜ 未支持 |
| `--threads-http` | number of threads used to process HTTP requests (default: -1) (env: LLAMA_ARG_THREADS_HTTP) | ⬜ 未支持 |
| `--cache-prompt`, `--no-cache-prompt` | whether to enable prompt caching (default: enabled) (env: LLAMA_ARG_CACHE_PROMPT) | ✅ 已支持 |
| `--cache-reuse` | min chunk size to attempt reusing from the cache via KV shifting, requires prompt caching to be enabled (default: 0) [(card)](https://ggml.ai/f0.png) (env: LLAMA_ARG_CACHE_REUSE) | ✅ 已支持 |
| `--metrics` | enable prometheus compatible metrics endpoint (default: disabled) (env: LLAMA_ARG_ENDPOINT_METRICS) | ✅ 已支持 |
| `--props` | enable changing global properties via POST /props (default: disabled) (env: LLAMA_ARG_ENDPOINT_PROPS) | ✅ 已支持 |
| `--slots`, `--no-slots` | expose slots monitoring endpoint (default: enabled) (env: LLAMA_ARG_ENDPOINT_SLOTS) | ✅ 已支持 |
| `--slot-save-path` | path to save slot kv cache (default: disabled) | ⬜ 未支持 |
| `--media-path` | directory for loading local media files; files can be accessed via file:// URLs using relative paths (default: disabled) | ⬜ 未支持 |
| `--models-dir` | directory containing models for the router server (default: disabled) (env: LLAMA_ARG_MODELS_DIR) | ⬜ 未支持 |
| `--models-preset` | path to INI file containing model presets for the router server (default: disabled) (env: LLAMA_ARG_MODELS_PRESET) | ⬜ 未支持 |
| `--models-max` | for router server, maximum number of models to load simultaneously (default: 4, 0 = unlimited) (env: LLAMA_ARG_MODELS_MAX) | ⬜ 未支持 |
| `--models-autoload`, `--no-models-autoload` | for router server, whether to automatically load models (default: enabled) (env: LLAMA_ARG_MODELS_AUTOLOAD) | ⬜ 未支持 |
| `--jinja`, `--no-jinja` | whether to use jinja template engine for chat (default: enabled) (env: LLAMA_ARG_JINJA) | ✅ 已支持 |
| `--reasoning-format` | controls whether thought tags are allowed and/or extracted from the response, and in which format they're returned; one of: - none: leaves thoughts unparsed in `message.content` - deepseek: puts thoughts in `message.reasoning_content` - deepseek-legacy: keeps `<think>` tags in `message.content` while also populating `message.reasoning_content` (default: auto) (env: LLAMA_ARG_THINK) | ✅ 已支持 |
| `-rea`, `--reasoning` | [on\|off\|auto]        Use reasoning/thinking in the chat ('on', 'off', or 'auto', default: 'auto' (detect from template)) (env: LLAMA_ARG_REASONING) | ✅ 已支持 |
| `--reasoning-effort` | reasoning effort level given to the chat template: 'default' to keep the template default, or a level such as 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max' (default: default) (env: LLAMA_ARG_REASONING_EFFORT) | ✅ 已支持 |
| `--reasoning-budget` | token budget for thinking: -1 for unrestricted, 0 for immediate end, N>0 for token budget (default: -1) (env: LLAMA_ARG_THINK_BUDGET) | ✅ 已支持 |
| `--reasoning-budget-message` | message injected before the end-of-thinking tag when reasoning budget is exhausted (default: none) (env: LLAMA_ARG_THINK_BUDGET_MESSAGE) | ✅ 已支持 |
| `--reasoning-preserve`, `--no-reasoning-preserve` | preserve reasoning trace in the full history, not just the last assistant message (default: template default) compatible with certain templates having 'supports_preserve_reasoning' capability example: https://docs.z.ai/guides/capabilities/thinking-mode#preserved-thinking (env: LLAMA_ARG_REASONING_PRESERVE) | ⬜ 未支持 |
| `--chat-template` | set custom jinja chat template (default: template taken from model's metadata) if suffix/prefix are specified, template will be disabled only commonly used templates are accepted (unless --jinja is set before this flag): list of built-in templates: bailing, bailing-think, bailing2, chatglm3, chatglm4, chatml, command-r, deepseek, deepseek-ocr, deepseek2, deepseek3, exaone-moe, exaone3, exaone4, falcon3, gemma, gigachat, glmedge, gpt-oss, granite, granite-4.0, granite-4.1, grok-2, hunyuan-dense, hunyuan-moe, hunyuan-vl, kimi-k2, llama2, llama2-sys, llama2-sys-bos, llama2-sys-strip, llama3, llama4, megrez, minicpm, mistral-v1, mistral-v3, mistral-v3-tekken, mistral-v7, mistral-v7-tekken, monarch, openchat, orion, pangu-embedded, phi3, phi4, rwkv-world, seed_oss, smolvlm, solar-open, vicuna, vicuna-orca, yandex, zephyr (env: LLAMA_ARG_CHAT_TEMPLATE) | ✅ 已支持 |
| `--chat-template-file` | set custom jinja chat template file (default: template taken from model's metadata) if suffix/prefix are specified, template will be disabled only commonly used templates are accepted (unless --jinja is set before this flag): list of built-in templates: bailing, bailing-think, bailing2, chatglm3, chatglm4, chatml, command-r, deepseek, deepseek-ocr, deepseek2, deepseek3, exaone-moe, exaone3, exaone4, falcon3, gemma, gigachat, glmedge, gpt-oss, granite, granite-4.0, granite-4.1, grok-2, hunyuan-dense, hunyuan-moe, hunyuan-vl, kimi-k2, llama2, llama2-sys, llama2-sys-bos, llama2-sys-strip, llama3, llama4, megrez, minicpm, mistral-v1, mistral-v3, mistral-v3-tekken, mistral-v7, mistral-v7-tekken, monarch, openchat, orion, pangu-embedded, phi3, phi4, rwkv-world, seed_oss, smolvlm, solar-open, vicuna, vicuna-orca, yandex, zephyr (env: LLAMA_ARG_CHAT_TEMPLATE_FILE) | ⬜ 未支持 |
| `--skip-chat-parsing`, `--no-skip-chat-parsing` | force a pure content parser, even if a Jinja template is specified; model will output everything in the content section, including any reasoning and/or tool calls (default: disabled) (env: LLAMA_ARG_SKIP_CHAT_PARSING) | ⬜ 未支持 |
| `--prefill-assistant`, `--no-prefill-assistant` | whether to prefill the assistant's response if the last message is an assistant message (default: prefill enabled) when this flag is set, if the last message is an assistant message then it will be treated as a full message and not prefilled | ⬜ 未支持 |
| `-sps`, `--slot-prompt-similarity` | how much the prompt of a request must match the prompt of a slot in order to use that slot (default: 0.10, 0.0 = disabled) | ⬜ 未支持 |
| `--lora-init-without-apply` | load LoRA adapters without applying them (apply later via POST /lora-adapters) (default: disabled) | ⬜ 未支持 |
| `--sleep-idle-seconds` | number of seconds of idleness after which the server will sleep (default: -1; -1 = disabled) | ⬜ 未支持 |
| `--log-prompts-dir` | Log prompts to directory (auto-created if not present; only used for debugging, default: disabled) | ⬜ 未支持 |
| `--embd-gemma-default` | use default EmbeddingGemma model (note: can download weights from the internet) | ⬜ 未支持 |
| `--fim-qwen-3b-default` | use default Qwen 2.5 Coder 3B (note: can download weights from the internet) | ⬜ 未支持 |
| `--fim-qwen-7b-default` | use default Qwen 2.5 Coder 7B (note: can download weights from the internet) | ⬜ 未支持 |
| `--fim-qwen-7b-spec` | use Qwen 2.5 Coder 7B + 0.5B draft for speculative decoding (note: can download weights from the internet) | ⬜ 未支持 |
| `--fim-qwen-14b-spec` | use Qwen 2.5 Coder 14B + 0.5B draft for speculative decoding (note: can download weights from the internet) | ⬜ 未支持 |
| `--fim-qwen-30b-default` | use default Qwen 3 Coder 30B A3B Instruct (note: can download weights from the internet) | ⬜ 未支持 |
| `--gpt-oss-20b-default` | use gpt-oss-20b (note: can download weights from the internet) | ⬜ 未支持 |
| `--gpt-oss-120b-default` | use gpt-oss-120b (note: can download weights from the internet) | ⬜ 未支持 |
| `--vision-gemma-4b-default` | use Gemma 3 4B QAT (note: can download weights from the internet) | ⬜ 未支持 |
| `--vision-gemma-12b-default` | use Gemma 3 12B QAT (note: can download weights from the internet) | ⬜ 未支持 |
| `--spec-default` | enable default speculative decoding config | ⬜ 未支持 |

## 汇总

- 官方参数总数：261
- 已支持：58
- 未支持：203
