<template>
  <div class="code-editor-wrapper">
    <codemirror
      v-model="code"
      placeholder="Enter your template content here..."
      :style="{ height: '400px' }"
      :autofocus="true"
      :indent-with-tab="true"
      :tab-size="2"
      :extensions="extensions"
      @update:modelValue="handleUpdate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';

const props = defineProps<{
  modelValue: string;
  language?: 'yaml' | 'json' | 'text';
}>();

const emit = defineEmits(['update:modelValue']);

const code = ref(props.modelValue);

// Watch for external changes to the modelValue
watch(() => props.modelValue, (newValue) => {
  if (newValue !== code.value) {
    code.value = newValue;
  }
});

const handleUpdate = (value: string) => {
  emit('update:modelValue', value);
};

const extensions = computed(() => {
  const langExt = [];
  if (props.language === 'yaml') {
    langExt.push(yaml());
  }
  // Add other languages here if needed, e.g., json()

  return [
    ...langExt,
    oneDark,
    EditorView.lineWrapping, // Enable line wrapping
  ];
});
</script>

<style scoped>
.code-editor-wrapper {
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: hidden;
  width: 100%;
}
</style>