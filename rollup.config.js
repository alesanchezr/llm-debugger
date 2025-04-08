// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';

export default {
  input: 'src/front/llm-debugger.js',
  output: {
    file: 'dist/llm-debugger.bundle.js',
    format: 'iife',
    name: 'LLMDebuggerBundle'
  },
  plugins: [
    resolve()
  ]
};