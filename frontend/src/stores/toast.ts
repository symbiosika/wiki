import type { ToastServiceMethods } from 'primevue/toastservice'

// Store reference to toast service
let toastService: ToastServiceMethods | null = null

// Initialize toast service (called from main.ts)
export const registerToastServiceGlobal = (service: ToastServiceMethods) => {
  toastService = service
}

export const showToast = (data: {
  severity?: 'info' | 'success' | 'warn' | 'error' | 'secondary' | 'contrast'
  summary?: string
  detail: string
  life?: number
}) => {
  if (!toastService) return

  toastService.add({
    severity: data.severity ?? 'info',
    summary: data.summary ?? '',
    detail: data.detail,
    life: data.life ?? 3000,
  })
}
