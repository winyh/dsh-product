declare module '@deepseek-ai/cordis' {
  interface Events {
    'product/report-previewed'(payload: { path?: string; sourceCount: number }): void
    'product/report-applied'(payload: { path: string }): void
  }
}
