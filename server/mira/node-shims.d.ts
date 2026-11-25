declare module 'node:fs/promises' {
  export interface FileHandle {
    close(): Promise<void>
    sync(): Promise<void>
    writeFile(data: string, encoding: 'utf8'): Promise<void>
  }
  export function mkdir(path: string, options: { recursive: boolean }): Promise<unknown>
  export function open(path: string, flags: string, mode?: number): Promise<FileHandle>
  export function readFile(path: string, encoding: 'utf8'): Promise<string>
  export function rename(oldPath: string, newPath: string): Promise<void>
  export function unlink(path: string): Promise<void>
}

declare module 'node:path' {
  export function dirname(path: string): string
}
