# 0.4.0 兼容扩展

这是尚未上传 npm 的本地版本。函数名、原包名及 0.3.0 入口全部保留；新版能力通过新增方法、子入口和可选参数提供。请使用本地 0.4.0 tgz 或分发归档验证。

## 调度、诊断与错误

`System` 新增 `before?: readonly string[]`、`after?: readonly string[]`，引用同阶段的系统 ID。启动或恢复前检查缺失引用、跨阶段引用与循环；无约束时保持 order 与同序注册顺序。约束在结构改变时重新编译。

```ts
const engine = new Engine({ diagnostics: false });
engine.addSystem({ id: 'movement', after: ['input'], update: move });
engine.addSystem({ id: 'input', update: readInput });
engine.start();
```

`move` 与 `readInput` 是游戏提供的 System.update 函数。旧代码不传 diagnostics 时，timings 仍按原方式采集。getSystems() 返回描述快照，getModules() 返回已安装模块 ID；不要通过修改这些结果改变引擎。

执行中注册系统在下一阶段生效；当前阶段采用快照，移除系统不会重写当前遍历。新增 before/after 配置视为注册时的配置，改变依赖请释放原 Scope 并重新注册。order 保持现有注册排序语义。

系统失败抛出 SystemError（仍为 Error），包含 systemId、phase、tick、cause；失败时停止引擎。停止监听器同时失败时，cause 为包含原故障及清理故障的 AggregateError。延迟命令失败也停止引擎，不再进入 render。

Engine.dispose 会在销毁事件失败后继续执行 Scope 与 World 清理。仅一个阶段失败时保留原异常；销毁事件与 Scope 同时失败时，以 AggregateError 保留两者。重复 dispose 不再清理或重复抛错。

World.query 保留开始迭代时的 handle 快照：新实体不加入当前遍历，销毁/重建后的实体不会替代旧 handle。组件交集在每个候选访问时检查，嵌套查询互不覆盖。每生命周期只创建一个冻结 handle，不能把对象身份当成跨销毁的永久 ID。

World.flush 执行取出的这一批命令；批内 defer 留到下一次 flush。失败时该批剩余命令不执行；销毁 World 后中止剩余命令。延迟命令不是可回滚事务。

## 资源与取消

AssetCache 的 get、clear、dispose 保留；新增 getStatus、delete、retain。load 仍接受旧的单参数函数，也可接收第二个 CancellationSignal。signal 提供 aborted、reason、subscribe、throwIfAborted，不依赖 DOM，**不是原生 AbortSignal**。

```ts
const cache = new AssetCache(async (url: string) => ({ url }));
const held = cache.retain('sprite');
await held.promise;
cache.clear(); // 仍被 retain 的资源保留
held.release(); // 最后一个持有者释放时删除；可重复调用
cache.dispose();
```

- delete(url) 对持有中的资源返回 false；getStatus 返回 idle/loading/ready/failed。
- clear 释放未被 retain 的条目；dispose 强制结束整个缓存并取消全部加载。
- load 应订阅取消通知；不响应取消的加载完成后仍会释放晚到资源一次。
- release 的异常保存在 releaseErrors，也可使用构造器第三个参数或 assetModule 的 onReleaseError 回调观察；不会产生无人处理的 Promise rejection。
- failed 条目在下次 get 时重新加载，或通过 delete/clear 清理。

接入 fetch 时，在自己的加载函数创建原生 AbortController，并用 signal.subscribe(() => controller.abort(signal.reason)) 桥接；加载结束后取消这个订阅。此设计让纯 TS/ES2022 消费者无需 DOM 类型。

## Transform、Camera、Sprite、Animation

从 `@xiaobaibaifqy/jingchuanchu-renderer-2d/features` 引用。原 Position2D、Shape2D 和 Canvas2D 入口保留。

```ts
import {
  Transform2D,
  Sprite2D,
  Animation2D,
  Camera2D,
  animationModule,
} from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';

const entity = engine.world.create();
engine.world.set(entity, Transform2D, { x: 20, y: 30, rotation: 0, scaleX: 1, scaleY: 1 });
engine.world.set(entity, Sprite2D, {
  image: loadedImage,
  width: 32,
  height: 32,
  anchorX: 0.5,
  anchorY: 0.5,
  layer: 2,
});
engine.world.set(entity, Animation2D, { frames: atlasFrames, fps: 8, loop: true });
engine.install([animationModule()]);
const camera = new Camera2D(0, 0, 1);
renderer.drawWorld(engine.world, camera);
```

loadedImage 为已加载的 CanvasImageSource，atlasFrames 为 `{x,y,width,height}` 数组。需先在开始前安装动画模块。固定逻辑步更新动画，暂停不会推进 elapsed；loop:false 的动画结束时 playing:false。重新播放时重置 elapsed/frame 并设 playing:true。可以在 Sprite.frame 设置初始帧。

Transform.rotation 和 Camera.rotation 单位为弧度。Transform.parent 是同 World、存活的 Entity；每次绘制重算变换，直接改组件数据下一帧可见。循环父子引用和无效 parent 会拒绝。一个实体同时有 Transform2D 与 Position2D 时，Transform2D 为其局部变换，Position2D 不叠加。

Sprite 支持图集 frame、anchorX/Y（比例）、flipX/Y、opacity 和 layer。图形与精灵统一按层级绘制。图形仍使用 Position2D 时保留原绘制行为；图形也可只使用 Transform2D。

Camera.x/y 表示屏幕原点对应的世界位置，zoom 必须为正；worldToScreen/screenToWorld 做正逆转换。canvas2DModule 新增可选 camera 参数；不传仍按旧方式绘制。Canvas2D 新增 resize(width,height,pixelRatio) 和 toWorldPoint(clientX,clientY,camera)。像素比上限保持 2；resize 更新画布缓冲，CSS 布局仍由应用设置。

Canvas 与图集依据：[drawImage](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage)、[transform](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/transform)。

## 场景生命周期

从 `@xiaobaibaifqy/jingchuanchu-core/scenes` 引用 SceneManager，仍不增加 npm 包，也不依赖 DOM。

```ts
const scenes = new SceneManager(engine);
await scenes.switchTo({
  id: 'level-1',
  async prepare(signal) {
    await loadLevel(signal);
  },
  setup(context) {
    const entity = context.create();
    context.engine.world.set(entity, Position2D, { x: 0, y: 0 });
    context.addSystem({ id: 'movement', update: move });
    context.scope.own(removeSceneListeners);
  },
});
```

loadLevel、move、removeSceneListeners 由游戏定义。prepare 可选且异步，setup 保持同步；Engine.install 的同步契约不变。场景系统 ID 自动添加实例前缀，场景内 before/after 使用局部 ID。context.setResource/getResource 是场景私有资源，Engine.world 的公共服务由应用显式共享。

新场景准备时旧场景仍运行。新准备/配置失败会清理候选并保留旧场景；成功后退出旧场景。连续切换会取消先前准备；忽略取消的准备结果也不会成为当前场景。成功切换后旧场景清理异常会报告，但新场景已激活，不能假装恢复已清理的旧场景。

准备期间被新切换替代或管理器销毁时，旧 switchTo 返回的 Promise 会因取消而拒绝，无需等待 prepare 完成。调用方应及时处理拒绝；加载器仍需响应 signal 才能中止实际 I/O，晚到的准备成功或失败均不会重新激活旧场景或形成未处理拒绝。

context.create、context.addSystem 自动登记到场景 Scope；直接 engine.world.create 或 engine.addSystem 属于应用管理，不会自动归场景。输入订阅、资源 lease 等自行登记 context.scope。pause/resume 控制当前场景系统，可用 Scene.onPause/onResume 清理输入；它们不暂停全 Engine 或公共网络。Engine.dispose 会销毁管理器。尚不支持单个 EngineModule 动态卸载。

## 基础碰撞

从 `@xiaobaibaifqy/jingchuanchu-renderer-2d/collision` 引用 Collider2D、detectCollisions、collisionModule。

Collider2D 支持 rect（width,height）与 circle（radius），可设 offsetX/Y、group、mask。默认 group=1、mask=-1；双方位掩码匹配才检测。使用 Transform2D 或 Position2D 定位。

rect 按世界 AABB 检测；旋转后的矩形使用包围盒。非均匀缩放/剪切后的 circle 使用保守包围圆，可能产生额外命中。边界接触算碰撞。采用沿 X 轴排序筛选，密集重叠时仍可能退化为 O(n²)，不是刚体物理。

下一版本（未发布）：detectCollisions(world, { cellSize }) 与 collisionModule({ cellSize }) 可选启用均匀网格宽阶段，cellSize 为格子边长（世界单位，正有限数），建议取常见碰撞体尺寸的 2 倍左右。默认仍用 X 轴排序筛选；实测网格在均匀、密集或含大碰撞体的分布下更慢，只在碰撞体集中在窄竖条（X 范围远小于 Y 范围）时明显更快，测量见 [性能记录](../performance/README.md)。两种方式返回相同的碰撞对，顺序都按 minX 排名，回调顺序不受影响。

collisionModule 的 onEnter/onStay/onExit 在固定步触发。销毁或分离产生退出，pair 内包含 Entity handle，使用前检查 World.isAlive；复用 index 的新 generation 不会误判为原碰撞。检测不自动移动实体或提供刚体响应。

## 网络可选策略

BrowserConnection 与 networkModule 新增同一组可选配置：onError、reconnect、heartbeat、maxBufferedBytes、maxQueuedMessages、maxQueuedBytes、socketFactory。不配置时不会自动重连或发送心跳。

- reconnect：maxAttempts 默认 5，delayMs 默认 250，maxDelayMs 默认 10,000；指数退避，成功 open 重置次数。只重试异常断开/服务器错误，正常关闭或协议错误不重试。close/Engine.stop/dispose 取消重试。
- heartbeat：intervalMs、timeoutMs、message()、可选 isResponse(message)。消息与应答属于游戏协议，必须被 decoder 接受；不配置 isResponse 时任意有效消息都能确认存活。它不是浏览器无法发送的 WebSocket 控制帧 ping。
- send(message) 保持原返回行为，积压时 false；send(message,{queue:true}) 可显式排队，true 表示接受，不代表服务器已经收到。
- 队列默认最多 64 条/256KiB；缓冲阈值默认 256KiB。超限返回 false 并报告 queue 错误；key 只用于游戏明确允许合并的可丢弃更新，可靠命令不要使用相同 key。
- 自动重连可保留显式排队消息，因此协议必须有身份/回合校验，必要时调用 close 取消旧队列再 connect；引擎不恢复身份或分数。close 清空队列，最终断开时未发送消息通过 onError 报告。
- onError 区分 decode/handler/transport/heartbeat/queue；lastError 保留最近故障。有效消息的业务回调失败不会把协议连接判为无效消息并关闭。
- stats 返回发送/接收数量、排队数量/字节、bufferedBytes 和重试次数。WebSocket.onopen 后才正常发送；send 成功也不等于对端确认。

积压含义依据：[WebSocket.bufferedAmount](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount)。
