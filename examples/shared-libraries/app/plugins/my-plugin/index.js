const { defineComponent, ref, computed, onMounted, openBlock, createElementBlock, createElementVNode, createVNode, unref, withCtx } = __tsm__.require("vue");
const { useRoute } = __tsm__.require("vue-router");
const Button = __tsm__.require("primevue/button").default;
const DataTable = __tsm__.require("primevue/datatable").default;
const Column = __tsm__.require("primevue/column").default;
const Dialog = __tsm__.require("primevue/dialog").default;
const _hoisted_1 = { class: "plugin-panel" };
const _hoisted_2 = { class: "controls" };
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "PluginPanel",
  setup(__props) {
    const route = useRoute();
    const count = ref(0);
    const doubled = computed(() => count.value * 2);
    const items = ref([
      { id: 1, name: "Item A", value: 100 },
      { id: 2, name: "Item B", value: 200 },
      { id: 3, name: "Item C", value: 300 }
    ]);
    const dialogVisible = ref(false);
    onMounted(() => {
      console.log("PluginPanel SFC mounted, route:", route.path);
    });
    const increment = () => count.value++;
    const showDialog = () => dialogVisible.value = true;
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", _hoisted_1, [
        _cache[2] || (_cache[2] = createElementVNode("h2", null, "Plugin Panel (SFC)", -1)),
        createElementVNode("div", _hoisted_2, [
          createVNode(unref(Button), {
            label: `Count: ${count.value} (doubled: ${doubled.value})`,
            onClick: increment
          }, null, 8, ["label"]),
          createVNode(unref(Button), {
            label: "Show Dialog",
            severity: "secondary",
            class: "ml-2",
            onClick: showDialog
          })
        ]),
        createVNode(unref(DataTable), {
          value: items.value,
          class: "mt-4"
        }, {
          default: withCtx(() => [
            createVNode(unref(Column), {
              field: "id",
              header: "ID"
            }),
            createVNode(unref(Column), {
              field: "name",
              header: "Name"
            }),
            createVNode(unref(Column), {
              field: "value",
              header: "Value"
            })
          ]),
          _: 1
        }, 8, ["value"]),
        createVNode(unref(Dialog), {
          visible: dialogVisible.value,
          "onUpdate:visible": _cache[0] || (_cache[0] = ($event) => dialogVisible.value = $event),
          header: "Plugin Dialog",
          modal: true
        }, {
          default: withCtx(() => [..._cache[1] || (_cache[1] = [
            createElementVNode("p", null, "This dialog is from the SFC plugin!", -1)
          ])]),
          _: 1
        }, 8, ["visible"])
      ]);
    };
  }
});
const _export_sfc = (sfc, props) => {
  const target = sfc.__vccOpts || sfc;
  for (const [key, val] of props) {
    target[key] = val;
  }
  return target;
};
const PluginPanel = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-3e57652e"]]);
const activate = (context) => {
  context.log.info("MyPlugin activated!");
  context.services.register("my-plugin.api", {
    getData: () => ({ message: "Hello from Plugin!" })
  });
};
const deactivate = (context) => {
  context.log.info("MyPlugin deactivated!");
  context.services.unregister("my-plugin.api");
};
const index = { activate, deactivate };
export {
  PluginPanel as MyPluginPanel,
  activate,
  deactivate,
  index as default
};
//# sourceMappingURL=index.js.map
