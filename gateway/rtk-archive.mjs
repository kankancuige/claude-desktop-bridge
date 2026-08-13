import crypto from 'node:crypto'

export function selectRtkReleaseAsset(assets, binaryName, platform) {
    const suffix = platform === 'win32' ? '.zip' : '.tar.gz'
    const base = binaryName.replace(/\.exe$/i, '')
    const matches = Array.isArray(assets)
        ? assets.filter(asset => typeof asset?.name === 'string'
            && asset.name.includes(base)
            && asset.name.toLowerCase().endsWith(suffix))
        : []
    if (matches.length !== 1) throw new Error(`RTK 发布资产匹配数量异常: ${matches.length}`)
    return matches[0]
}

export function verifyRtkAssetDigest(buffer, digest) {
    const match = /^sha256:([a-f0-9]{64})$/i.exec(String(digest || ''))
    if (!match) throw new Error('RTK 发布资产缺少可信 SHA-256 digest')
    const actual = crypto.createHash('sha256').update(buffer).digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(match[1], 'hex'))) {
        throw new Error('RTK 下载文件 SHA-256 校验失败')
    }
    return actual
}

export function buildWindowsRtkExtractArgs() {
    const extractScript = [
        "$ErrorActionPreference = 'Stop'",
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        '$zip = [System.IO.Compression.ZipFile]::OpenRead($env:BRIDGE_RTK_ARCHIVE_PATH)',
        'try {',
        "  $entry = $zip.Entries | Where-Object { $_.FullName -eq 'rtk.exe' -and -not $_.FullName.EndsWith('/') } | Select-Object -First 1",
        "  if ($null -eq $entry) { throw 'rtk.exe not found in archive' }",
        '  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $env:BRIDGE_RTK_DESTINATION_PATH, $true)',
        '} finally { $zip.Dispose() }',
    ].join('; ')
    return ['-NoProfile', '-NonInteractive', '-Command', extractScript]
}

export function buildWindowsRtkExtractEnv(zipPath, destinationPath, baseEnv = process.env) {
    return {
        ...baseEnv,
        BRIDGE_RTK_ARCHIVE_PATH: zipPath,
        BRIDGE_RTK_DESTINATION_PATH: destinationPath,
    }
}
