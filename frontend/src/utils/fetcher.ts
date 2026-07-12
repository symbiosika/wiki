/**
 * A simple wrapper around fetch to make it easier to use
 * and to have a central place to add authentication and the backend url
 */

export const API_BASE_URL = {
  path: '',
};

export class FetcherError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(body || `Request failed with status ${status}`);
    this.name = 'FetcherError';
  }
}

const redirectToLogin = () => {
  const redirect = encodeURIComponent(window.location.href);
  document.cookie =
    'jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; secure; samesite=strict';
  window.location.href = `/login.html?redirectUrl=${redirect}`;
};

const handleResponse = async <T>(
  response: Response,
  returnAsText = false,
): Promise<T> => {
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
    }
    throw new FetcherError(response.status, body);
  }

  if (returnAsText) {
    return response.text() as any;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
};

export const fetcher = {
  // get
  async get<T>(url: string, returnAsText = false): Promise<T> {
    const response = await fetch(API_BASE_URL.path + url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return handleResponse<T>(response, returnAsText);
  },

  // getBlob
  async getBlob(url: string): Promise<Blob> {
    const response = await fetch(API_BASE_URL.path + url, {});
    if (!response.ok) {
      const body = await response.text();
      if (response.status === 401 || response.status === 403) {
        redirectToLogin();
      }
      throw new FetcherError(response.status, body);
    }
    return response.blob();
  },

  // post
  async post<T>(url: string, body: any, returnAsText = false): Promise<T> {
    const response = await fetch(API_BASE_URL.path + url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response, returnAsText);
  },

  // postFormData
  async postFormData<T>(
    url: string,
    formData: FormData,
    returnAsText = false,
  ): Promise<T> {
    const response = await fetch(API_BASE_URL.path + url, {
      method: 'POST',
      body: formData,
    });
    return handleResponse<T>(response, returnAsText);
  },

  // put
  async put<T>(url: string, body: any, returnAsText = false): Promise<T> {
    const response = await fetch(API_BASE_URL.path + url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response, returnAsText);
  },

  // patch
  async patch<T>(url: string, body: any, returnAsText = false): Promise<T> {
    const response = await fetch(API_BASE_URL.path + url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response, returnAsText);
  },

  // delete
  async delete<T>(url: string, returnAsText = false): Promise<T> {
    const response = await fetch(API_BASE_URL.path + url, {
      method: 'DELETE',
    });
    return handleResponse<T>(response, returnAsText);
  },
};
