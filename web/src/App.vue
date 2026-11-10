<script setup lang="ts">
const stack = ['Vue 3', 'Vite', 'TypeScript', 'Deno Edge Function']
</script>

<template>
  <main class="min-h-screen bg-neutral-950 px-6 py-16 text-neutral-100">
    <section class="mx-auto max-w-2xl">
      <p class="text-sm tracking-[0.3em] text-neutral-500">CAREERSIM TS</p>
      <h1 class="mt-4 text-4xl font-semibold">第一阶段脚手架</h1>
      <p class="mt-4 text-neutral-400">
        main 分支只包含最小可构建工程与依赖；业务逻辑在 feat/ts-migration 分支迁移。
      </p>
      <ul class="mt-8 flex flex-wrap gap-2">
        <li
          v-for="item in stack"
          :key="item"
          class="rounded-full border border-neutral-700 px-3 py-1 text-sm text-neutral-300"
        >
          {{ item }}
        </li>
      </ul>
    </section>
  </main>
</template>
