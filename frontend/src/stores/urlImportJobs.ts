import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type {
  UrlImportJob,
  UrlImportJobDetail,
  UrlImportJobInput,
  UrlImportJobUrl,
  UrlImportRun,
} from '@/types/urlImport'

const api = (tenantId: string) => `/api/v1/tenant/${tenantId}/url-import/jobs`

export const useUrlImportJobs = defineStore('urlImportJobs', () => {
  const jobs = ref<UrlImportJob[]>([])
  const loading = ref(false)

  const loadJobs = async (tenantId: string) => {
    loading.value = true
    try {
      jobs.value = await fetcher.get<UrlImportJob[]>(api(tenantId))
    } finally {
      loading.value = false
    }
  }

  const createJob = async (
    tenantId: string,
    input: UrlImportJobInput,
  ): Promise<UrlImportJob> => {
    const job = await fetcher.post<UrlImportJob>(api(tenantId), input)
    await loadJobs(tenantId)
    return job
  }

  const getJob = (tenantId: string, jobId: string) =>
    fetcher.get<UrlImportJobDetail>(`${api(tenantId)}/${jobId}`)

  const updateJob = (
    tenantId: string,
    jobId: string,
    input: Partial<UrlImportJobInput>,
  ) => fetcher.put<UrlImportJob>(`${api(tenantId)}/${jobId}`, input)

  const deleteJob = async (tenantId: string, jobId: string) => {
    await fetcher.delete(`${api(tenantId)}/${jobId}`)
    await loadJobs(tenantId)
  }

  const setUrls = (
    tenantId: string,
    jobId: string,
    urls: { url: string; title?: string | null }[],
  ) =>
    fetcher.put<UrlImportJobUrl[]>(`${api(tenantId)}/${jobId}/urls`, { urls })

  const listRuns = (tenantId: string, jobId: string) =>
    fetcher.get<UrlImportRun[]>(`${api(tenantId)}/${jobId}/runs`)

  const runNow = (tenantId: string, jobId: string) =>
    fetcher.post<UrlImportRun>(`${api(tenantId)}/${jobId}/run`, {})

  return {
    jobs,
    loading,
    loadJobs,
    createJob,
    getJob,
    updateJob,
    deleteJob,
    setUrls,
    listRuns,
    runNow,
  }
})
