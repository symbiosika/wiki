export interface OAuthClient {
  id: string
  clientId: string
  clientName: string
  clientType: 'public' | 'confidential'
  redirectUris: string[]
  scopes: string[]
  tokenEndpointAuthMethod: string
  disabledAt: string | null
  createdAt: string
}

export interface OAuthClientInput {
  clientName: string
  redirectUris: string[]
  scopes: string[]
  clientType: 'public' | 'confidential'
}

export interface OAuthClientCreated {
  clientId: string
  /** Only returned once, directly after creating a confidential client. */
  clientSecret?: string
}
