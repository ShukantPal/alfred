export interface CompanyDelegateRequest {
  meetingId: string;
  speaker: {
    id: string;
    displayName: string;
  };
  question: string;
}

export interface CompanyDelegate {
  ask(request: CompanyDelegateRequest): Promise<string>;
  close(): void | Promise<void>;
}
