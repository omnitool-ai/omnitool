import mime from 'mime-types';
import detectContentType from 'detect-content-type';
import { fileTypeFromBuffer } from 'file-type';
import sanitize from 'sanitize-filename';
import {extname, basename} from 'path'
import { string } from '@tensorflow/tfjs-core';

const mangleFilename =  function(fileName: string, overrideExtension?: string): string {
  const newName = sanitize(fileName, { replacement: '_' }).toLowerCase();
  let ext = extname(newName);
  const base = basename(newName, ext);
  if (overrideExtension && !overrideExtension.startsWith('.')) {
    overrideExtension = '.' + overrideExtension;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  ext = overrideExtension || extname(newName) || '';

  return `${base}${ext}`;
}


export const sanitizeFilename = function (fileName: string, extName?: string)
{ 
  return mangleFilename(
    fileName, extName
  );
}

interface FileDetectionResult{
  sanitizedFilename: string
  mimeType: string
  extName: string
}




export const detectFileDetails = async function(fid:string, data: Buffer, opts: { fileName?: string, mimeType?:string, encoding?: string  }): Promise<FileDetectionResult> 
{
  let {fileName, mimeType, encoding} = opts
  let extName:string = ''
 
  fileName = fileName?.trim()

  if (fileName)
  {
    const fromBuffer = await fileTypeFromBuffer(data)
    if (fromBuffer)
    {
      mimeType ||= mime.lookup(fileName) || fromBuffer.mime
      extName ||= extname(fileName) || fromBuffer.ext 
    }
    mimeType ||= mime.lookup(fileName) || detectContentType(data)
    fileName = basename(fileName,extName)
    extName ||= mime.extension(mimeType) || '.bin'
  }
  else
  {
    const fromBuffer = await fileTypeFromBuffer(data)
    if (fromBuffer)
    {
      mimeType ||= fromBuffer.mime
      extName ||= fromBuffer.ext 
    }
    mimeType ||= detectContentType(data)
    if  (encoding === 'utf8')
    {
      fileName = data.toString('utf8').substring(0, 20).trim().replace(/[^a-z0-9]/gi, '_');
      if (mimeType.startsWith('text/markdown')) {
        extName = 'md';
      } else if (mimeType.startsWith('text/html')) {
        extName = 'html';
      } else if (mimeType.startsWith('text/svg')) {
        extName = 'html';
      } else {
        extName = mime.extension(mimeType) || 'txt' 
    
      }
    }
    else
    {
      fileName = `${Date.now()}_${fid.replace(',','-')}`
      extName = mime.extension(mimeType) || 'bin'
    }
  }


  return {
    sanitizedFilename: sanitizeFilename(fileName, extName),
    extName,
    mimeType
  }
}

   
  