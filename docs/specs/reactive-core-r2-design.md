# R2 调度器归属设计草案

## 问题

当前 `scheduler.ts` 是全局单例，多个应用共享 `effectQueue` 和 `renderQueue`。Effect/render 出错时通过 `reportScheduledError` 报告给 `globalThis.reportError` 或微任务抛出，**无法路由到所属应用的 `onError`**。

具体场景：

1. 两个独立应用 A 和 B 挂载在同一页面（例如微前端）
2. 应用 A 的某个 effect 抛错
3. 错误被 `flushSync` 捕获后，无法知道该 effect 属于 A 还是 B
4. 错误只能全局报告，应用 A 的 `onError` 收不到

## 方案对比

### 方案 1：保持全局队列，追踪 effect 所属 Owner

**实施**：

- `effect()` 创建时记录所属 `Owner`（通过增加 `owner?: Owner` 参数，或通过全局上下文栈）
- `EffectTask` 接口增加 `readonly owner?: Owner` 字段
- `Owner` 增加 `onError?: (error: unknown) => void` 字段，应用挂载时设置
- `flushSync()` 捕获错误后，查找 `task.owner?.onError`，找到则调用，否则降级到 `reportScheduledError`

**优点**：

- 最小改动，保持调度器单例
- 兼容现有代码（`owner` 可选，无 owner 的 effect 降级到全局报告）
- 跨应用的响应式依赖（如果存在）自然工作

**缺点**：

- 一个应用的无限 effect 循环仍然阻塞所有应用
- 需要 `effect()` 调用方传入 `owner`，增加调用方负担
- `Owner` 和调度器耦合，打破当前的分层

### 方案 2：每应用独立调度器

**实施**：

- 将 `effectQueue` / `renderQueue` / `flushQueued` 等状态封装到 `Scheduler` 类
- `Scheduler` 实例化时接收 `onError?: (error: unknown) => void`
- `Owner` 持有 `readonly scheduler: Scheduler`，应用挂载时注入
- `effect()` / `scheduleRender()` 从上下文的 `Owner` 获取调度器实例
- 每个应用的 `Owner` 树共享一个调度器，不同应用的 Owner 树用不同调度器

**优点**：

- 彻底隔离，一个应用的无限循环不影响其他应用
- 错误路由天然正确
- 更符合"应用是独立单元"的语义

**缺点**：

- 重大架构变更，影响所有 `effect()` / `scheduleRender()` 调用点
- 跨应用的响应式依赖会导致多个调度器同时刷新，需要协调机制
- 测试代码需要显式传入调度器或 Owner

### 方案 3：全局队列 + 错误上下文栈

**实施**：

- 保持全局队列
- `effect()` 执行时，将 `owner` 推入全局栈 `const ownerStack: Owner[] = []`
- `flushSync()` 捕获错误时，从栈顶读取 Owner 并调用其 `onError`
- 执行完成后弹出栈

**优点**：

- 中等改动，不改变 `effect()` 签名
- 错误路由正确

**缺点**：

- 需要维护全局栈，增加运行时开销
- 异步场景（如果未来支持）栈会错乱
- 一个应用的无限循环仍然阻塞所有应用

## 推荐方案（修正）

**方案 2（每应用独立调度器）**，理由：

### 场景驱动

本引擎的实际场景是"可以整合多个游戏，又可以只放单个游戏"（多游戏集合页或微前端）。在此场景下：

- **性能隔离**：游戏 A 的每帧状态更新不应阻塞游戏 B 的渲染
- **错误隔离**：游戏 A 的 effect 无限循环不应让游戏 B 卡死
- **生命周期独立**：游戏 A 暂停时，游戏 B 的调度不受影响
- **调试友好**：独立队列便于定位哪个游戏的性能问题

### 性能优势

全局队列的问题：

- 批处理粒度过粗：所有游戏的 effect 混在一起，必须等全部稳定
- 虚假依赖：游戏 A 触发 flush，游戏 B 即使无脏数据也要等待
- GC 压力共享：游戏 A 的临时对象影响游戏 B 的 GC 暂停

独立调度器后：

- 微任务独立，A 的 flush 不阻塞 B
- `MAX_EFFECT_TURNS` 限制独立，A 的无限循环只杀死 A
- 内存压力更容易归因

### 实施成本可控

1. **调用点改动有限**：`effect()` / `scheduleRender()` 已经在组件/应用上下文中，都有 Owner，只需从 Owner 获取 scheduler
2. **向后兼容**：提供全局默认 scheduler（单例），无 Owner 的代码降级使用它
3. **测试更好**：每个测试用独立 scheduler，避免状态泄漏

### 与方案 1 对比

方案 1 只解决错误路由，不解决性能隔离。对于"多游戏整合"场景，性能隔离是核心需求，不是可选优化。

## 实施细节（方案 2）

### 改动点

1. **封装 Scheduler 类**：

   ```ts
   export class Scheduler {
     private batchDepth = 0;
     private flushQueued = false;
     private readonly effectQueue = new Set<EffectTask>();
     private readonly renderQueue = new Set<RenderTask>();

     constructor(private readonly onError?: (error: unknown) => void) {}

     scheduleEffect(task: EffectTask): void {
       this.effectQueue.add(task);
       this.queueFlush();
     }

     scheduleRender(task: RenderTask): void {
       this.renderQueue.add(task);
       this.queueFlush();
     }

     flushSync(): void {
       // 当前 flushSync 逻辑，错误路由到 this.onError
     }

     // batch, isBatching, pendingUpdates 等方法
   }
   ```

2. **Owner 持有 Scheduler**：

   ```ts
   export class Owner {
     readonly scope = new Scope();
     readonly scheduler: Scheduler;

     constructor(
       private readonly parent?: Owner,
       scheduler?: Scheduler,
     ) {
       // 子 Owner 继承父级 scheduler（同一应用共享）
       this.scheduler = scheduler ?? parent?.scheduler ?? defaultScheduler;
       parent?.children.push(this);
     }
   }
   ```

3. **应用创建独立 Scheduler**：

   ```ts
   export async function mountApplication(
     container: Element,
     definition: ApplicationDefinition,
   ): Promise<ApplicationInstance> {
     const scheduler = new Scheduler(definition.onError);
     const owner = new Owner(undefined, scheduler);
     // ...
   }
   ```

4. **effect() 从 Owner 获取 Scheduler**：

   ```ts
   // 方案 A：effect() 增加 owner 参数
   export function effect(
     run: (onCleanup: (cleanup: Cleanup) => void) => void,
     scope: Scope,
     owner?: Owner,
   ): Cleanup {
     const scheduler = owner?.scheduler ?? defaultScheduler;
     // ...
     node.notifyDirty() {
       scheduler.scheduleEffect(node);
     }
   }

   // 方案 B（推荐）：从 Scope 反向获取 Owner
   // Scope 创建时记录 owner，effect 从 scope 获取
   ```

5. **全局默认 Scheduler**：

   ```ts
   const defaultScheduler = new Scheduler((error) => {
     if (typeof globalThis.reportError === 'function') {
       globalThis.reportError(error);
     } else {
       queueMicrotask(() => {
         throw error;
       });
     }
   });
   ```

6. **scheduleRender 改为实例方法或全局辅助**：
   ```ts
   // 当前：全局函数 scheduleRender(task)
   // 改为：从上下文获取 scheduler

   // 组件运行时已有 owner，改动点：
   // packages/app/runtime/component.ts 的 scheduleRender 调用
   ```

### 不改动

- reactive-core 的公开 API（`signal` / `computed` / `effect` / `batch`）签名保持
- `effect()` 通过 `Scope` 关联 Owner，不需要调用方显式传 `owner`
- 现有测试用默认 scheduler，单应用场景不受影响

### Scope 关联 Owner 的实现

```ts
// packages/core/scope.ts 或 packages/app/runtime/component-owner.ts

export class Scope {
  // 新增
  private owner?: Owner;

  // Owner 创建 Scope 时调用
  setOwner(owner: Owner): void {
    if (this.owner) throw new Error('Scope owner already set');
    this.owner = owner;
  }

  getOwner(): Owner | undefined {
    return this.owner;
  }
}

// Owner 构造器
export class Owner {
  readonly scope = new Scope();
  readonly scheduler: Scheduler;

  constructor(parent?: Owner, scheduler?: Scheduler) {
    this.scheduler = scheduler ?? parent?.scheduler ?? defaultScheduler;
    this.scope.setOwner(this); // 关联
    parent?.children.push(this);
  }
}

// effect() 获取 scheduler
export function effect(
  run: (onCleanup: (cleanup: Cleanup) => void) => void,
  scope: Scope,
): Cleanup {
  const owner = scope.getOwner();
  const scheduler = owner?.scheduler ?? defaultScheduler;
  // ...
}
```

### 验收

1. **隔离验证**：
   - 两个应用 A 和 B，A 的 effect 无限循环，只抛出 A 的错误，B 正常运行
   - A 的每帧大量 effect，B 的帧率不受影响（用 performance.now() 测量）

2. **错误路由**：
   - A 的 effect 出错，只调用 A 的 onError
   - B 的 render 出错，只调用 B 的 onError

3. **向后兼容**：
   - 无 Owner 的 effect（测试代码）用默认 scheduler，错误全局报告
   - 单应用场景（现有所有测试）行为不变

4. **内存**：
   - 每个 Scheduler 的队列独立，应用 dispose 后其 scheduler 可被 GC

### 风险

1. **Scope 来自 core 包**：
   - core 包不应依赖 app 包的 Owner
   - 解决：`Scope.setOwner(owner: unknown)` / `getOwner(): unknown`，类型擦除

2. **scheduleRender 的调用点**：
   - 需要找到所有 `scheduleRender()` 调用，改为从上下文获取 scheduler
   - 缓解：先保留全局 `scheduleRender`（用默认 scheduler），逐步迁移

---

**决策**：采纳方案 2（每应用独立调度器），针对"多游戏整合"场景优化性能和错误隔离。

**下一步**：实施 R2，包含 Scheduler 类封装、Owner 持有 scheduler、Scope 关联 Owner、验收测试。
