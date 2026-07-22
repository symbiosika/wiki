declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'

  type TurndownPlugin = TurndownService.Plugin

  /** Combined plugin: tables + strikethrough + task list items */
  export const gfm: TurndownPlugin

  /** Tables only */
  export const tables: TurndownPlugin

  /** Strikethrough only */
  export const strikethrough: TurndownPlugin

  /** Task list items only */
  export const taskListItems: TurndownPlugin
}
