# Prism Ikvm

A browser remake of [Prism Launcher](https://prismlauncher.org) built on top of
[ikvmcraft](https://github.com/r58playz/ikvmcraft) / Prism-Launcher-Browser.

The launcher is a Prism-style frontend for the IKVM/WASM Minecraft runtime:

- Multiple instances, each with its own game directory (worlds, mods, options)
- Vanilla and Fabric instances, Minecraft 1.13–26.2
- Mods, resource packs, worlds and logs tabs per instance
- Microsoft device-code sign-in plus offline accounts
- Per-instance settings, notes, groups, icons, playtime and last-played
- File browser backed by the browser's Origin Private File System
- Game launches in a second tab and streams logs back to the launcher

The .NET/IKVM runtime, download logic and WebGPU renderer come from the
ikvmcraft source below. This project only replaces the frontend.

Modern Minecraft + drop-in mods loaded dynamically in the browser with mono-wasm and IKVM. Uses a custom fork of IKVM with exact OpenJDK classloading semantics and other wasm patches, as well as a custom fork of mono with a full wasm JIT tier significantly improving performance over interp/jiterp.

![Minecraft 26.2 with Fabulously Optimized modpack](assets/26.2-fabulouslyoptimized.png)
Minecraft 26.2 with Fabulously Optimized modpack

![Minecraft 1.16.5 in-game with 24 render distance](assets/1.16.5-24render.png)
Minecraft 1.16.5 in-game with 24 render distance

![Minecraft 1.16.5 in-game with BSL Medium & 12 render distance](assets/1.16.5-bsl.png)
Minecraft 1.16.5 in-game with BSL Medium & 12 render distance

Supports Minecraft 1.13-26.2 with Fabric 0.19.x (other Fabric versions not tested but may work). Java runtime is mostly Java 25 compliant. Uses OpenGL 4.6 on top of WebGPU.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

## building

1. download dotnet 10, a jdk, and potentially also mono. be on linux.
2. run `sudo dotnet workload restore` in `loader` folder
3. run `make build` in this folder to build
4. run `make serve` to serve a DEVELOPMENT version that SHOULD NOT BE HOSTED PUBLICLY.
5. run `make publish` to build a PRODUCTION version in `frontend/dist` folder.

## frontend only

```sh
cd frontend
npm install
npx tsc --noEmit
npm run build
```

`dreamland` is vendored as `vendor/dreamland-0.1.3.tgz`, so the frontend can be
installed with npm or pnpm without pulling from GitHub. A full build still needs
the `_framework` output and static game files produced by `make build`.
