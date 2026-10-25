# ikvmcraft

Modern Minecraft + drop-in mods loaded dynamically in the browser with mono-wasm and IKVM. Uses a custom fork of IKVM with exact OpenJDK classloading semantics and other wasm patches, as well as a custom fork of mono with a full wasm JIT tier significantly improving performance over interp/jiterp.

![Minecraft 26.2 with Fabulously Optimized modpack](assets/26.2-fabulouslyoptimized.png)
Minecraft 26.2 with Fabulously Optimized modpack

![Minecraft 1.16.5 in-game with 24 render distance](assets/1.16.5-24render.png)
Minecraft 1.16.5 in-game with 24 render distance

![Minecraft 1.16.5 in-game with BSL Medium & 12 render distance](assets/1.16.5-bsl.png)
Minecraft 1.16.5 in-game with BSL Medium & 12 render distance

Supports Minecraft 1.13-26.2 with Fabric 0.19.x (other Fabric versions not tested but may work). Java runtime is mostly Java 25 compliant. Uses OpenGL 4.6 on top of WebGPU.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

python3 gen-static-libs.py /ikvm/bin/libiava.so:out/native/libiava.a /ikvm/bin/libzip.so:out/native/libzip.a /ikvm/bin/libnio.so:out/native/libnio.a /ikvm/bin/libnet.so:out/native/libnet.a /ikvm/bin/libprefs.so:out/native/libprefs.a /ikvm/bin/libmanagement.so:out/native/libmanagement.a /ikvm/bin/libmanagement_ext.so:out/native/libmanagement_ext.a /ikvm/bin/libjavajpeg.so:out/native/libjavajpeg.a /ikvm/bin/libmlib_image.so:out/native/libmlib_image.a /ikvm/bin/liblcms.so:out/native/liblcms.a /ikvm/bin/libawt.so:out/native/libawt.a /ikvm/bin/libawt_headless.so:out/native/libawt_headless.a /ikvm/bin/libfontmanager.so:out/native/libfontmanager.a /tmp/lwjgl/liblwjgl.so:../native-deps/out/mt/liblwjgl3.a /tmp/lwjgl/libglfw.so:../native-deps/out/mt/libglfw3.a /tmp/lwjgl/liblwjgl_stb.so:../native-deps/out/mt/liblwjgl_stb.a /tmp/lwjgl/libopenal.so:../native-deps/out/mt/liblwjgl_openal.a /tmp/lwjgl/libfreetype.so:out/native/libfreetype.a --rename-symbol /tmp/lwjgl/libglfw.so:emscripten_glfw3_get_proc_address:glfwGetProcAddress --add-alias /tmp/lwjgl/libglfw.so:glfw3 --add-alias /tmp/lwjgl/libglfw.so:/tmp/lwjgl/liblwjgl_opengl.so --add-alias /tmp/lwjgl/libglfw.so:/tmp/lwjgl/libGL.so.1 --add-alias /tmp/lwjgl/liblwjgl.so:/tmp/lwjgl/liblwjgl_tinyfd.so > ../../../ikvmcraft/loader/statics.c
