# Native preset bundle adapter

This optional headless executable provides the PrusaSlicer `PresetBundle` import,
compatibility, full-configuration and bundle-export APIs missing from the stock CLI.
It compiles unmodified upstream source files at PrusaSlicer 2.9.6 commit
`b028299c770b8380ee81c921a2867d522f288123`. CMake rejects a different source commit.
It does not start a GUI, slice a model, contact a printer or execute post-processing.

## Build

The native adapter build is supported on macOS with Apple Clang. The stock CLI
integration remains available on platforms without this optional executable.
The source subset uses linker dead-code removal to omit unrelated slicing and
image code; configuration and inheritance algorithms remain upstream code.

Install CMake 3.31 and Ninja, and use a directory outside the product checkout:

```sh
git clone --branch version_2.9.6 https://github.com/prusa3d/PrusaSlicer.git prusaslicer-source
git -C prusaslicer-source checkout b028299c770b8380ee81c921a2867d522f288123
cmake -S prusaslicer-source/deps -B native-deps -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0
cmake --build native-deps --target dep_Boost dep_Eigen dep_TBB dep_Cereal \
  dep_LibBGCode dep_json dep_JPEG dep_NanoSVG
cmake -S /absolute/path/to/PrusaMCP/native -B native-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DPRUSASLICER_SOURCE_DIR="$(pwd)/prusaslicer-source" \
  -DCMAKE_PREFIX_PATH="$(pwd)/native-deps/destdir/usr/local"
cmake --build native-build --parallel 6
```

Dependencies use the versions and hashes pinned by the upstream dependency
recipes (LibBGCode also builds heatshrink). Keep the build dependency prefix in
place. Set `PRUSAMCP_NATIVE_CONFIG_PATH` to the absolute path of
`native-build/prusamcp-preset-core` in the MCP server environment.

## Private process protocol

The executable takes one argument: a UTF-8 JSON request file. Requests are made
by the TypeScript bridge in a temporary operation directory. All input profile
data must first be copied into that directory. Never pass a user profile folder
as `datadir`.

Common fields:

- `operation`: `import` or `resolve`.
- `datadir`: isolated profile directory, optionally containing native vendor/user files.
- `bundle_path`: optional INI bundle to load with native `load_configbundle`.
- `output_bundle_path`: private output artifact, published by the TypeScript bridge.

Resolve additionally takes `selection: {printer, print, materials: string[]}`,
`output_flat_path` and optional `overrides_path` (flat native INI). The printer
selects FFF/SLA technology. FFF needs one material per extruder; SLA needs one.
Native compatibility checks reject incompatible tuples. Native full-config
validation runs before a resolved output is returned.

Successful stdout is JSON with `protocol: 1`, `version: "2.9.6"`, `profiles`
(`kind`, `name`, native serialized `settings`), `substitutions` (`kind`, `name`,
`key`) and `omitted_fields`. Resolve also returns `technology` and `selection`.
Overrides use the native full-config splitter, preserving source printer/print
names and producing distinct native material names per extruder. In this case `selection` names
the exported presets and `source_selection` retains the requested tuple.

The exporter receives a fresh bundle containing only sanitized copies of the
chosen native configurations, with inherited dependencies flattened. Host keys,
physical printer data and `post_process` are excluded; omitted names are disclosed
without their values. Custom printer G-code remains configuration text and is
never executed. Raw native error messages and logging are suppressed; failures
return a fixed error code and exit 1. Stdout must be consumed only as JSON.

## Source and license

The adapter links PrusaSlicer code licensed under AGPL-3.0-or-later; this native
adapter source is provided under the same license. See
[LICENSE.PrusaSlicer](LICENSE.PrusaSlicer). Distributing a compiled helper must
include the corresponding adapter source, build files, and matching upstream
source (including upstream copyright/license notices and dependency notices),
as required by that license. This repository distributes adapter source, not an
opaque prebuilt slicer binary.
