import {basename, extname} from 'node:path'

const KIND_BY_EXTENSION = new Map([
    ['.png', 'image'], ['.jpg', 'image'], ['.jpeg', 'image'], ['.gif', 'image'],
    ['.webp', 'image'], ['.svg', 'image'], ['.bmp', 'image'], ['.tif', 'image'], ['.tiff', 'image'],
    ['.pdf', 'pdf'],
    ['.doc', 'word'], ['.docx', 'word'], ['.rtf', 'word'], ['.odt', 'word'],
    ['.xls', 'spreadsheet'], ['.xlsx', 'spreadsheet'], ['.csv', 'spreadsheet'], ['.ods', 'spreadsheet'],
    ['.ppt', 'presentation'], ['.pptx', 'presentation'], ['.odp', 'presentation'],
    ['.txt', 'text'], ['.md', 'text'], ['.json', 'text'], ['.xml', 'text'], ['.html', 'text'],
    ['.htm', 'text'], ['.yaml', 'text'], ['.yml', 'text'], ['.log', 'text'],
    ['.zip', 'archive'], ['.7z', 'archive'], ['.rar', 'archive'],
])

const KIND_BY_CONTENT_TYPE = new Map([
    ['application/pdf', 'pdf'],
    ['application/msword', 'word'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'],
    ['application/vnd.ms-excel', 'spreadsheet'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet'],
    ['application/vnd.ms-powerpoint', 'presentation'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation'],
    ['text/plain', 'text'], ['text/markdown', 'text'], ['text/csv', 'spreadsheet'],
    ['application/zip', 'archive'],
])

const IMAGE_KINDS = new Set(['image'])

export function describeAttachment(filename, contentType = '') {
    const originalName = basename(String(filename || '')) || 'attachment'
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filenameExt = extname(safeName).toLowerCase()
    const normalizedContentType = String(contentType || '').split(';', 1)[0].trim().toLowerCase()
    // 文件名扩展名优先于客户端 MIME，防止错误的 image/png MIME 把 docx 误判成图片。
    const kind = KIND_BY_EXTENSION.get(filenameExt) || KIND_BY_CONTENT_TYPE.get(normalizedContentType) || 'binary'
    return {
        originalName,
        safeName,
        extension: KIND_BY_EXTENSION.has(filenameExt) ? filenameExt : '.bin',
        kind,
        contentType: normalizedContentType || 'application/octet-stream',
    }
}

export function isImageAttachment(descriptor) {
    return IMAGE_KINDS.has(descriptor?.kind)
}
