/**
 * 极小的 React 替身：只实现 client.js 用到的那部分（createElement + 5 个 hook）。
 *
 * 目的：在 DSH 之外把设置页**真的渲染出来**并驱动交互，这样页面里的崩溃、
 * 契约错位、数据流断裂都能在 test/client.test.mjs 里被抓到，而不是等到实机刷新。
 *
 * 不是通用 React：没有 key 复用、没有并发、没有 context，够用即可。
 */

export function createMiniReact() {
  let fibers = []; // 按先序下标复用，保证 hook 状态跨渲染存活
  let current = null;
  let hookIndex = 0;
  let root = null;
  let scheduled = false;
  const afterRender = [];

  function createElement(type, props, ...children) {
    const flat = [];
    const push = (value) => {
      if (Array.isArray(value)) value.forEach(push);
      else if (value !== null && value !== undefined && value !== false && value !== true) flat.push(value);
    };
    push(children);
    const next = { ...(props || {}) };
    // 组件里的 props.children 在 react 里是「单个或多个」，这里统一成数组之外的形态。
    if (flat.length === 1) next.children = flat[0];
    else if (flat.length > 1) next.children = flat;
    return { $$el: true, type, props: next };
  }

  const isElement = (value) => Boolean(value && typeof value === 'object' && value.$$el === true);
  const toArray = (value) =>
    value === null || value === undefined || value === false || value === true
      ? []
      : Array.isArray(value)
        ? value
        : [value];

  function sameDeps(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
    return true;
  }

  function schedule() {
    root.dirty = true;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      flushRender();
    });
  }

  /* ---------------- hooks ---------------- */

  function useState(initial) {
    const fiber = current;
    const index = hookIndex++;
    if (fiber.hooks.length <= index) {
      fiber.hooks[index] = typeof initial === 'function' ? initial() : initial;
    }
    const set = (next) => {
      const value = typeof next === 'function' ? next(fiber.hooks[index]) : next;
      if (Object.is(value, fiber.hooks[index])) return;
      fiber.hooks[index] = value;
      schedule();
    };
    return [fiber.hooks[index], set];
  }

  function useMemo(factory, deps) {
    const fiber = current;
    const index = hookIndex++;
    const prev = fiber.memo[index];
    if (prev && sameDeps(prev.deps, deps)) return prev.value;
    const value = factory();
    fiber.memo[index] = { value, deps };
    return value;
  }

  function useCallback(fn, deps) {
    return useMemo(() => fn, deps);
  }

  function useRef(initial) {
    const fiber = current;
    const index = hookIndex++;
    if (fiber.refs[index] === undefined) fiber.refs[index] = { current: initial };
    return fiber.refs[index];
  }

  function useEffect(fn, deps) {
    const fiber = current;
    const index = hookIndex++;
    const slot = fiber.effects[index] || (fiber.effects[index] = { deps: undefined, cleanup: undefined });
    const changed = deps === undefined || !sameDeps(slot.deps, deps);
    slot.deps = deps;
    if (changed) {
      afterRender.push(() => {
        if (typeof slot.cleanup === 'function') slot.cleanup();
        slot.cleanup = fn() || undefined;
      });
    }
  }

  /* ---------------- renderer ---------------- */

  function flushRender() {
    if (!root || !root.dirty) return;
    let guard = 0;
    while (root.dirty && guard < 25) {
      guard += 1;
      root.dirty = false;
      afterRender.length = 0;
      let cursor = 0;
      const prevFibers = fibers;
      fibers = [];
      const walk = (node) => {
        if (node === null || node === undefined || node === false || node === true) return null;
        if (typeof node === 'string' || typeof node === 'number') {
          return { kind: 'text', text: String(node), children: [] };
        }
        if (Array.isArray(node)) {
          return { kind: 'fragment', children: node.map(walk).filter(Boolean) };
        }
        if (!isElement(node)) return null;

        if (typeof node.type === 'function') {
          const index = cursor++;
          const fiber = prevFibers[index] && prevFibers[index].type === node.type
            ? prevFibers[index]
            : { type: node.type, hooks: [], memo: [], refs: [], effects: [] };
          fibers[index] = fiber;
          const outer = current;
          const outerIndex = hookIndex;
          current = fiber;
          hookIndex = 0;
          const rendered = node.type(node.props);
          current = outer;
          hookIndex = outerIndex;
          return {
            kind: 'component',
            type: node.type,
            fiber,
            props: node.props,
            children: toArray(rendered).map(walk).filter(Boolean),
          };
        }

        return {
          kind: 'host',
          type: node.type,
          props: node.props,
          children: toArray(node.props.children).map(walk).filter(Boolean),
        };
      };
      root.tree = walk(root.element);
      for (const effect of afterRender) effect();
    }
  }

  /** 渲染一个元素。返回一个可继续交互的句柄。 */
  function render(element) {
    root = { element, tree: null, dirty: true };
    fibers = [];
    flushRender();
    return {
      get tree() {
        return root.tree;
      },
      /** 重新渲染（测试里手工用）。 */
      rerender() {
        root.dirty = true;
        flushRender();
      },
    };
  }

  /** 等所有 pending 的微任务 / 定时器 / 重渲染跑完。 */
  async function flush(times = 12) {
    for (let i = 0; i < times; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushRender();
    }
    flushRender();
  }

  /* ---------------- 查询辅助 ---------------- */

  function walkTree(node, visit) {
    if (!node) return undefined;
    const stop = visit(node);
    if (stop !== undefined) return stop;
    for (const child of node.children || []) {
      const found = walkTree(child, visit);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function textOf(node) {
    if (!node) return '';
    if (node.kind === 'text') return node.text;
    return (node.children || []).map(textOf).join('');
  }

  function findAll(node, predicate) {
    const out = [];
    walkTree(node, (item) => {
      if (predicate(item)) out.push(item);
      return undefined;
    });
    return out;
  }

  /** 按可见文字找元素（默认找按得到的东西）。 */
  function findByText(node, text, tag) {
    return findAll(
      node,
      (item) =>
        item.kind !== 'text' &&
        (!tag || item.type === tag) &&
        textOf(item).trim() === String(text).trim(),
    )[0];
  }

  function findAllByTag(node, tag) {
    return findAll(node, (item) => item.type === tag);
  }

  function click(element) {
    element.props.onClick({ preventDefault() {}, stopPropagation() {} });
  }

  function type(element, value) {
    element.props.onChange({ target: { value } });
  }

  return {
    react: { createElement, useState, useEffect, useMemo, useCallback, useRef },
    render,
    flush,
    walkTree,
    textOf,
    findAll,
    findAllByTag,
    findByText,
    click,
    type,
  };
}
