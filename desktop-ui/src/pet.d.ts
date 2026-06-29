declare module 'virtual:pet-list' {
  const list: { id: string; label: string; src: string }[]
  export default list
}

/** vite define 构建时常量 */
declare const __REPO_URL__: string
declare const __BUILD_TIME__: string
declare const __COPYRIGHT__: string
