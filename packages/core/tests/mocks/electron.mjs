// electron 在 core 单元测试中的最小占位实现：仅提供 BrowserWindow 的类引用，
// 真实行为由测试侧用普通对象（含 id / isDestroyed）模拟，不依赖 Electron 运行时。
export class BrowserWindow {
  constructor() {}
}
