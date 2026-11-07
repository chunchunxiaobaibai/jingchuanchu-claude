# API 参考

适用 0.4.0。参数名称对应源码；`T` 表示调用方定义的数据类型。所有引擎模块 ID、组件 token 与系统 ID 都在各自实例范围中使用。

## @xiaobaibaifqy/jingchuanchu-ecs

### 类型与 token

| 导出                       | 定义/用途                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Entity                     | `{ readonly worldId: symbol; readonly index: number; readonly generation: number }`           |
| Token<T>                   | `{ readonly key: symbol; readonly name: string; readonly __type?: T }`，__type 仅辅助类型推导 |
| component<T>(name: string) | 返回唯一 Token<T>，相同 name 不代表相同组件                                                   |
| resource<T>(name: string)  | component 的别名，用于明确世界资源用途                                                        |

### World

`new World()` 创建独立世界。

| 成员              | 参数与返回                                                | 行为                                          |
| ----------------- | --------------------------------------------------------- | --------------------------------------------- |
| size              | number，只读                                              | 存活实体数量，销毁世界后为 0                  |
| create            | `(): Entity`                                              | 创建/复用实体，返回冻结的 handle              |
| isAlive           | `(entity: Entity): boolean`                               | 检查 World 归属、代际和存活                   |
| destroy           | `(entity: Entity): boolean`                               | 移除所有组件；无效 handle 返回 false          |
| set<T>            | `(entity, token: Token<T>, value: NoInfer<T>): void`      | 添加/替换组件；无效实体抛错                   |
| get<T>            | `(entity, token): T \| undefined`                         | 无组件或无效实体返回 undefined                |
| require<T>        | `(entity, token): T`                                      | 无效实体或缺失组件抛错；返回引用              |
| has<T>            | `(entity, token): boolean`                                | 是否拥有组件，无效实体为 false                |
| remove<T>         | `(entity, token): void`                                   | 移除组件，无效实体抛错                        |
| query             | `(...tokens: Token<unknown>[]): IterableIterator<Entity>` | 组件交集；没有 token 时所有存活实体           |
| setResource<T>    | `(token, value: NoInfer<T>): void`                        | 保存资源，可覆盖                              |
| getResource<T>    | `(token): T`                                              | 缺失抛错                                      |
| hasResource<T>    | `(token): boolean`                                        | 检查资源存在                                  |
| removeResource<T> | `(token): boolean`                                        | 删除资源，返回是否删除                        |
| defer             | `(command: (world: World) => void): void`                 | 排队结构变更或其他命令                        |
| flush             | `(): void`                                                | 执行当前批次命令；其中新 defer 的命令等待下批 |
| dispose           | `(): void`                                                | 清空实体、组件、资源和命令；可重复调用        |

dispose 后 create/set/require/remove/query、资源操作、defer/flush 不可使用。get/isAlive/has/destroy 的无效引用行为如表中所示。
组件值允许 undefined 时用 has 区分“存在且值为 undefined”与“缺失”。

## @xiaobaibaifqy/jingchuanchu-core

### Engine、System 与更新上下文

`new Engine(options?: { tickRate?: number; maxSteps?: number })`，默认 30 和 5。tickRate 必须有限且大于 0，maxSteps 必须正整数。不要在运行中修改 options。

```ts
interface UpdateContext {
  world: World;
  delta: number; // 秒
  tick: number; // 当前固定步序号
  alpha: number;
}
interface System {
  id: string;
  phase?: 'fixed' | 'render'; // 默认 fixed
  order?: number; // 默认 0
  update(context: UpdateContext): void;
}
interface EngineModule {
  id: string;
  dependencies?: readonly string[];
  setup(engine: Engine, scope: Scope): void;
}
```

| 成员       | 参数/返回                                                  | 说明                                                    |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| world      | World                                                      | 此实例的世界，生命周期由 Engine 管理                    |
| scope      | Scope                                                      | 根作用域，应用可登记清理                                |
| events     | EventBus<EngineEvents>                                     | 生命周期事件                                            |
| step       | number                                                     | 1/tickRate，单位秒                                      |
| options    | 配置对象                                                   | 构造选项，运行时不修改                                  |
| status     | EngineStatus                                               | stopped/running/paused/disposed                         |
| timings    | SystemTiming[]                                             | 最近一次 advance 的执行耗时记录；`{ id, milliseconds }` |
| hasModule  | `(id: string): boolean`                                    | 已提交安装的模块是否存在                                |
| install    | `(modules: readonly EngineModule[]): void`                 | 同步、依赖排序、分批安装与失败回滚                      |
| provide<T> | `(token: Token<T>, value: NoInfer<T>, scope: Scope): void` | 唯一服务注册与作用域清理                                |
| addSystem  | `(system: System, scope?: Scope): void`                    | 注册系统，默认使用根 scope                              |
| start      | `(): void`                                                 | 启动；已 running 时不重复启动；重置时间累积，不清空世界 |
| pause      | `(): void`                                                 | running → paused                                        |
| resume     | `(): void`                                                 | paused → running，累积归零                              |
| stop       | `(): void`                                                 | 停止推进，累积归零，保留世界/系统                       |
| advance    | `(seconds: number): void`                                  | running 时推进；暂停/停止时不执行                       |
| dispose    | `(): void`                                                 | 通知 disposed，反向清理，再销毁 World；幂等             |

EngineEvents 的 started、paused、resumed、stopped、disposed payload 均为 undefined。销毁后 start/pause/resume/stop/advance/install/provide/addSystem 抛错。

### Scope 与事件

| API                  | 参数/返回                              | 说明                                       |
| -------------------- | -------------------------------------- | ------------------------------------------ |
| new Scope            | `()`                                   | 创建清理容器                               |
| Scope.own            | `(cleanup: () => void): () => void`    | 登记并返回原函数；关闭后立即执行新登记函数 |
| Scope.dispose        | `(): void`                             | 反向清理全部函数，聚合异常，不等待 Promise |
| new EventBus<Events> | `()`                                   | 类型化同步事件                             |
| EventBus.on          | `(name, listener, scope?): () => void` | 返回幂等取消函数，可绑定 scope             |
| EventBus.emit        | `(name, payload): void`                | 按本次捕获的监听器列表同步通知，异常聚合   |
| EventBus.clear       | `(): void`                             | 删除所有订阅                               |

emit 中新增的订阅不会进入本次通知；清除/取消也不改变已经捕获的本次列表。EventBus 不做 payload 克隆或帧间缓存。

## @xiaobaibaifqy/jingchuanchu-browser

| API             | 参数/返回                                                                                                 | 说明                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| browserModule   | `(options?: { driver?: BrowserDriver; onError?: (error: unknown) => void }): EngineModule`                | ID browser-runtime；不在 setup 自动 start                                                                                                                                                                                       |
| runBrowser      | `(engine, onError, options?: { driver?: BrowserDriver; scope?: Scope; autoStart?: boolean }): () => void` | 底层驱动；autoStart 默认 true；返回函数只移除驱动，不销毁 Engine                                                                                                                                                                |
| createFrameLoop | `(driver: BrowserDriver, onFrame: (seconds) => void, options?: { maxDelta?: number }): FrameLoop`         | 下一版本（未发布）。共享帧调度：`start/stop/resetTime/running`，首帧与 `resetTime` 后报告 0 秒，`maxDelta` 默认不限；回调抛错时停止并重新抛出。runBrowser 不限制间隔（固定步由 Engine `maxSteps` 限制），GameCanvas 限制为 1 秒 |

BrowserDriver 的方法：requestFrame(callback: (milliseconds: number) => void): number、cancelFrame(id: number): void、isHidden(): boolean、subscribeVisibility(callback: () => void): () => void。
默认驱动使用 requestAnimationFrame 和 document.hidden。发生推进异常时停止驱动/引擎并调用 onError；browserModule 默认 onError 输出到 console.error。

## @xiaobaibaifqy/jingchuanchu-renderer-2d

### 普通入口

| API          | 参数/返回                                                          | 说明                                           |
| ------------ | ------------------------------------------------------------------ | ---------------------------------------------- |
| Point        | `{ x: number; y: number }`                                         | 逻辑坐标                                       |
| Stroke       | `{ points: Point[]; color: string; width: number }`                | 绘画数据，与游戏网络协议分离                   |
| Position2D   | Token<Point>                                                       | 位置组件                                       |
| Shape2D      | `Token<{ kind: 'circle' \| 'rect'; color; width; height; layer }>` | 图形组件，字符串颜色和数值尺寸/层              |
| new Canvas2D | `(canvas: HTMLCanvasElement, width?: number, height?: number)`     | 默认 960×600；保存 context/canvas/width/height |
| toPoint      | `(clientX: number, clientY: number): Point`                        | CSS 坐标映射到画布并限制范围                   |
| clear        | `(color?: string): void`                                           | 默认 #ffffff，填满逻辑画布                     |
| stroke       | `(stroke: Stroke): void`                                           | 空点数组忽略；单点画圆点；多点画圆头线段       |
| drawWorld    | `(world: World): void`                                             | 按 layer 绘制位置/图形组件，不自动 clear       |

### /module 入口

`Renderer2D: Token<Canvas2D>`。
`canvas2DModule({ canvas, width?, height?, renderWorld?, background? }): EngineModule`，ID renderer-2d。
renderWorld 默认 true，内置 render 系统 ID renderer-2d:world，order=100；每帧 clear 后 drawWorld。renderWorld=false 时由游戏自定义绘制。

## @xiaobaibaifqy/jingchuanchu-input

| API               | 参数/返回                                                                           | 说明                            |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| new KeyboardInput | `(target: EventTarget, preventDefault?: readonly string[])`                         | 默认不阻止键盘默认动作          |
| isDown            | `(code: string): boolean`                                                           | 查询按住状态                    |
| clear             | `(): void`                                                                          | 清空按键                        |
| dispose           | `(): void`                                                                          | 清空并移除监听                  |
| PointerHandlers   | `{ down(event: PointerEvent); move(event: PointerEvent); up(event: PointerEvent) }` | 指针回调，均返回 void           |
| bindPointer       | `(canvas, handlers: PointerHandlers, scope: Scope): void`                           | 捕获、结束和清理，支持鼠标/触摸 |

`/module` 导出：

- Keyboard: Token<KeyboardInput>。
- keyboardModule(options?: { target?: EventTarget; preventDefault?: readonly string[] }): EngineModule，ID keyboard-input，默认 target=window。
- pointerModule({ id?: string; canvas: HTMLCanvasElement; handlers: PointerHandlers }): EngineModule，默认 ID pointer-input，可以不同 ID 安装多个指针绑定。

## @xiaobaibaifqy/jingchuanchu-assets

`new AssetCache<T>(load: (url: string) => Promise<T>, release?: (asset: T) => void)`。

| 方法             | 返回       | 说明                             |
| ---------------- | ---------- | -------------------------------- |
| get(url: string) | Promise<T> | 共享相同 URL 的加载；失败可重试  |
| clear()          | void       | 清空并登记释放，允许随后再次 get |
| dispose()        | void       | clear 后关闭，新 get 拒绝        |

`/module` 导出 `assetModule<T>({ id?, load, release? }): AssetModule<T>`，默认 ID assets。
AssetModule<T> 扩展 EngineModule，额外字段 cache: Token<AssetCache<T>>。setup 创建服务，dispose 清理缓存。

## @xiaobaibaifqy/jingchuanchu-net

### BrowserConnection<Client, Server>

构造参数：decoder: Decoder<Server>、onMessage: (message: Server) => void、onStatus: (status: 'connecting' | 'open' | 'closed' | 'error') => void。

| 成员    | 参数/返回                         | 说明                                                    |
| ------- | --------------------------------- | ------------------------------------------------------- |
| status  | idle/connecting/open/closed/error | 初始 idle                                               |
| connect | `(url: string): void`             | 替换旧连接，异步开始连接                                |
| send    | `(message: Client): boolean`      | 未 open 或积压超过 256 KiB 返回 false；不排队           |
| close   | `(): void`                        | 移除 socket 回调并关闭；主动 close 不触发 onStatus 回调 |

接收 JSON parse 或 decoder/onMessage 回调异常时上报 error 并关闭连接。需要清晰的应用错误日志时自行捕获 onMessage 中的玩法异常。

### 类型与其他工具

| API                  | 参数/返回                                           | 说明                                 |
| -------------------- | --------------------------------------------------- | ------------------------------------ |
| Decoder<T>           | `parse(value: unknown): T`                          | 运行时校验失败应抛错                 |
| Peer                 | `readonly id: string; send(message: unknown): void` | 服务端连接接口                       |
| new RateLimit        | `(maximum: number, windowMs?: number)`              | 默认窗口 1000ms                      |
| RateLimit.allow      | `(now: number): boolean`                            | 窗口限额；now 单位毫秒，建议同一时钟 |
| new RoomDirectory<T> | `(capacity?: number, maxRooms?: number)`            | 默认 10 人、100 房间                 |
| RoomDirectory.size   | number                                              | 房间数                               |
| create               | `(id: string, value: T): void`                      | 重复 ID 或房间超额抛错               |
| get                  | `(id: string): T \| undefined`                      | 读取房间值                           |
| join                 | `(id: string, member: string): T`                   | 房间不存在、已加入或满员抛错         |
| leave                | `(id: string, member: string): boolean`             | 是否为空；不自动删房间               |
| remove               | `(id: string): void`                                | 移除目录项，不调用房间 dispose       |
| values               | `(): IterableIterator<T>`                           | 当前房间值的快照迭代器               |

`/module`：networkModule<Client, Server>({ id?, url: string | (() => string), decoder, onMessage, onStatus? }): NetworkModule<Client, Server>，默认 ID network。
额外字段 connection 是服务 token。started 时连接，暂停不关闭，停止/销毁关闭；暂停中新增实例在 resumed 时首次连接。

## @xiaobaibaifqy/jingchuanchu-net-server

`new WebSocketHost<Client>(http: node:http.Server, decoder: Decoder<Client>, handlers, allowedOrigins?: readonly string[])`。
handlers 包含 open(peer)、message(peer, message: Client)、close(peer)、error(peer, message: string)，均同步返回 void。allowedOrigins 默认空列表。
`close(): Promise<void>` 停止心跳、终止连接并关闭 WebSocketServer，不负责 HTTP Server.close。

只有这个包依赖外部 ws。默认消息/连接/发送限制见 [联网接入](networking.md)。客户端身份与游戏权限由应用实现。

## 应用套件与开发工具

app 新增 defineGame、defineScene、defineInput、defineView、bootstrapGame、mountGame、mountView、viewInputs、StateStore、ViewError 及对应类型。tooling/vite 提供 jingchuanchu 插件，CLI 提供 create/generate/check。完整签名以包声明为准，参数、绑定语法和迁移见 [应用套件手册](application-suite.md)。原有入口和函数保持兼容。
