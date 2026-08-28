export type VersionedWorkflow<W> = {
  readonly name: string
  readonly version: number
  readonly workflow: W
}

export const versionedWorkflow = <W>(name: string, version: number, workflow: W): VersionedWorkflow<W> => ({ name, version, workflow })
