import { defineStore, storeToRefs } from 'pinia';
import { ref, watchEffect } from 'vue';
import { addI18nMessages, useLocale } from '@arco-design/web-vue/es/locale';
import arcoEnUS from '@arco-design/web-vue/es/locale/lang/en-us';
import {
  tr,
  setLang,
  PARAMS,
  paramLabel as _paramLabel,
  paramHelp as _paramHelp,
  type Language,
  type Dict,
} from '@llama-launcher/shared';
import { useSettingsStore } from './settings';

// Arco 组件自带的文案（popconfirm 的确定/取消、table 空态、pagination 的条数、上传与日期
// 面板等）走的是库内另一套 i18n，不配置就永远停在随包注册的 zh-CN——实测英文界面下删除预设
// 的浮层按钮仍是「取消/确定」。这里注册英文包并按当前语言切档，界面文案不再有第二种语言。
addI18nMessages({ 'en-US': arcoEnUS });

export const useI18nStore = defineStore('i18n', () => {
  // 以 settings.language 为唯一数据源，自动同步 shared 模块的语言状态
  const settings = useSettingsStore();
  const { language } = storeToRefs(settings);
  const lang = ref<Language>(language.value);

  watchEffect(() => {
    const l = language.value;
    setLang(l);
    useLocale(l === 'en' ? 'en-US' : 'zh-CN');
    // 读屏按 html[lang] 选发音规则与翻译策略；index.html 里写死的 zh-CN 不跟随切换时，
    // 英文界面会被用中文音库念出来
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    lang.value = l;
  });

  // 读取 lang.value 注册响应式依赖，确保语言切换后组件重新渲染
  const t = (key: keyof Dict | string, args?: (string | number)[]): string => {
    void lang.value;
    return tr(key, args);
  };

  // 包装 paramLabel/paramHelp：读取 lang.value 注册响应式依赖，
  // 这样所有参数组件（SliderParam/DropdownParam/...）在语言切换后会重新渲染
  const paramLabel = (key: string): string => {
    void lang.value;
    return _paramLabel(key);
  };

  const paramHelp = (key: string): string => {
    void lang.value;
    // 推测解码（speculative）子分组参数项悬浮只显示参数名称：该组参数帮助文案
    // 信息量大、悬浮阅读负担重，显示名称即可（返回值仅用于参数行 ToolTip）。
    if (PARAMS.find((p) => p.key === key)?.subcategory === 'speculative') {
      return _paramLabel(key);
    }
    return _paramHelp(key);
  };

  return { lang, t, paramLabel, paramHelp };
});
