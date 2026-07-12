import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetcher } from '@/utils/fetcher'
import { useWiki } from '@/stores/wiki'

export interface CreatedProtocol {
  success: boolean
  entryId: string
  title: string
  summary: string
  actionItems: string[]
}

export interface ProcessResult {
  success: boolean
  processedFacts: number
  updatedCategories: string[]
  newCategories: string[]
  errors: string[]
}

const api = (tenantId: string) => `/api/v1/tenant/${tenantId}/protocol`

export const useProtocol = defineStore('protocol', () => {
  /** UI: whether the "record protocol" dialog is open (mounted once in the layout). */
  const dialogOpen = ref(false)
  const openDialog = () => {
    dialogOpen.value = true
  }

  /** Send a recorded audio blob and get the transcript back. */
  const transcribe = async (
    tenantId: string,
    audio: Blob,
  ): Promise<string> => {
    const fd = new FormData()
    fd.append('audio', audio, 'recording.webm')
    const res = await fetcher.postFormData<{ success: boolean; text: string }>(
      `${api(tenantId)}/transcribe`,
      fd,
    )
    return res.text
  }

  /** Structure a transcript and file it as a dated wiki page. */
  const createProtocol = async (
    tenantId: string,
    transcript: string,
  ): Promise<CreatedProtocol> => {
    const res = await fetcher.post<CreatedProtocol>(api(tenantId), {
      transcript,
    })
    // the new page lives under the "Tagesprotokolle" folder — refresh the tree
    useWiki().loadTree(tenantId)
    return res
  }

  /** Merge the protocol's facts into the digital-twin brain (Wissensbasis). */
  const processProtocol = async (
    tenantId: string,
    protocol: string,
  ): Promise<ProcessResult> => {
    const res = await fetcher.post<ProcessResult>(`${api(tenantId)}/process`, {
      protocol,
    })
    useWiki().loadTree(tenantId)
    return res
  }

  return {
    dialogOpen,
    openDialog,
    transcribe,
    createProtocol,
    processProtocol,
  }
})
