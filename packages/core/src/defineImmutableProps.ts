/**
 * 以不可变、不可枚举、不可重配置的方式将属性挂载到目标对象上。
 * 相比 Object.assign 更安全——外部无法通过遍历/删除/重写篡改这些方法。
 * 对象类型的值会浅冻结（Object.freeze），防止内部键被增删改。
 *
 * @internal 仅供框架适配层（vue/react）内部使用，不作为公共 API 导出
 */
export function defineImmutableProps<T extends object>(target: T, props: Record<string, unknown>): T {
  for (const key of Object.keys(props)) {
    const val = props[key];
    Object.defineProperty(target, key, {
      value: val !== null && typeof val === 'object' ? Object.freeze(val) : val,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  return target;
}
