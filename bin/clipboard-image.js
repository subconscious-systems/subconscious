/**
 * Reads a PNG or JPEG from the OS clipboard. Terminal Ctrl+V does not deliver
 * image pixels, so the feedback prompt calls this when that key is pressed.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function imageContentType(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }
  return null;
}

async function readDarwinClipboard() {
  const script = `
    try
      set pngData to the clipboard as «class PNGf»
    on error
      return "NONE"
    end try
    set outPath to POSIX path of (path to temporary items from user domain) & "subc-clipboard.png"
    set outFile to open for access POSIX file outPath with write permission
    set eof of outFile to 0
    write pngData to outFile
    close access outFile
    return outPath
  `;
  const { stdout } = await execFileAsync('osascript', ['-e', script]);
  const outPath = String(stdout).trim();
  if (!outPath || outPath === 'NONE') return null;
  const { readFile, rm } = await import('node:fs/promises');
  try {
    return await readFile(outPath);
  } finally {
    await rm(outPath, { force: true });
  }
}

async function readLinuxClipboard() {
  const commands = [
    ['wl-paste', ['--type', 'image/png']],
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
  ];
  for (const [command, args] of commands) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        encoding: 'buffer',
        maxBuffer: 8 * 1024 * 1024,
      });
      if (stdout?.length) return stdout;
    } catch {
      // Try the next clipboard tool.
    }
  }
  return null;
}

async function readWindowsClipboard() {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    if ($null -eq $image) { exit 2 }
    $path = Join-Path $env:TEMP 'subc-clipboard.png'
    $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $path
  `;
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      script,
    ]);
    const outPath = String(stdout).trim();
    if (!outPath) return null;
    const { readFile, rm } = await import('node:fs/promises');
    try {
      return await readFile(outPath);
    } finally {
      await rm(outPath, { force: true });
    }
  } catch {
    return null;
  }
}

export async function readClipboardImage() {
  if (process.platform === 'darwin') return readDarwinClipboard();
  if (process.platform === 'win32') return readWindowsClipboard();
  return readLinuxClipboard();
}
