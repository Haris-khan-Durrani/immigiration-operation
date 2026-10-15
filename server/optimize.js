import sharp from 'sharp';
import {PDFDocument} from 'pdf-lib';
// Optimize optional CRM copies only. Original evidence/review bytes are immutable.
export async function optimize(bytes,mime) {
 try {
  let output;
  if(mime==='image/png')output=await sharp(bytes,{limitInputPixels:40000000}).png({compressionLevel:9}).toBuffer();
  else if(mime==='image/jpeg')output=await sharp(bytes,{limitInputPixels:40000000}).jpeg({quality:90,mozjpeg:true}).toBuffer();
  else if(mime==='application/pdf') {
   if(bytes.includes(Buffer.from('/ByteRange')))return bytes;
   const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
   if(pdf.getForm().getFields().length)return bytes;
   output=Buffer.from(await pdf.save({useObjectStreams:true,updateFieldAppearances:false}));
  }
  return output && output.length<bytes.length?output:bytes;
 }catch{return bytes;}
}
