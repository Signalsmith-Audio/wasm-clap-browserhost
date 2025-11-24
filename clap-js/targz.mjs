export {expandTarGz as default};

async function expandTarGz(tarResponse) {
	let stream = new DecompressionStream('gzip');
	stream = tarResponse.body.pipeThrough(stream);
	let arrayBuffer = await (new Response(stream)).arrayBuffer();
	
	let tarFileStream = new UntarFileStream(arrayBuffer);
	let fileMap = {};
	while (tarFileStream.hasNext()) {
		let file = tarFileStream.next();
		if (file.type == '0' || file.type == "\0" || file.type == "") {
			fileMap[file.name] = file.buffer;
		}
	}
	return fileMap;
}

// Modified from js-untar: https://github.com/InvokIT/js-untar/blob/master/src/untar-worker.js @license MIT
/*
The MIT License (MIT)

Copyright (c) 2015 Sebastian Jørgensen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
function decodeUTF8(e){if("function"==typeof TextDecoder)return(new TextDecoder).decode(e);for(var r="",t=0;t<e.length;){var n=e[t++];if(127<n){if(191<n&&n<224){if(e.length<=t)throw"UTF-8 decode: incomplete 2-byte sequence";n=(31&n)<<6|63&e[t]}else if(223<n&&n<240){if(e.length<=t+1)throw"UTF-8 decode: incomplete 3-byte sequence";n=(15&n)<<12|(63&e[t])<<6|63&e[++t]}else{if(!(239<n&&n<248))throw"UTF-8 decode: unknown multibyte start 0x"+n.toString(16)+" at index "+(t-1);if(e.length<=t+2)throw"UTF-8 decode: incomplete 4-byte sequence";n=(7&n)<<18|(63&e[t])<<12|(63&e[++t])<<6|63&e[++t]}++t}if(n<=65535)r+=String.fromCharCode(n);else{if(!(n<=1114111))throw"UTF-8 decode: code point 0x"+n.toString(16)+" exceeds UTF-16 reach";n-=65536,r=(r+=String.fromCharCode(n>>10|55296))+String.fromCharCode(1023&n|56320)}}return r}function PaxHeader(e){this._fields=e}function TarFile(){}function UntarStream(e){this._bufferView=new DataView(e),this._position=0}function UntarFileStream(e){this._stream=new UntarStream(e),this._globalPaxHeader=null}PaxHeader.parse=function(e){for(var r=new Uint8Array(e),t=[];0<r.length;){var n=parseInt(decodeUTF8(r.subarray(0,r.indexOf(32)))),a=decodeUTF8(r.subarray(0,n)).match(/^\d+ ([^=]+)=((.|\r|\n)*)\n$/);if(null===a)throw new Error("Invalid PAX header data format.");var i=a[1],a=a[2],i=(0===a.length?a=null:null!==a.match(/^\d+$/)&&(a=parseInt(a)),{name:i,value:a});t.push(i),r=r.subarray(n)}return new PaxHeader(t)},PaxHeader.prototype={applyHeader:function(t){this._fields.forEach(function(e){var r=e.name,e=e.value;"path"===r?(r="name",void 0!==t.prefix&&delete t.prefix):"linkpath"===r&&(r="linkname"),null===e?delete t[r]:t[r]=e})}},UntarStream.prototype={readString:function(e){for(var r=+e,t=[],n=0;n<e;++n){var a=this._bufferView.getUint8(this.position()+ +n,!0);if(0===a)break;t.push(a)}return this.seek(r),String.fromCharCode.apply(null,t)},readBuffer:function(e){var r,t,n;return"function"==typeof ArrayBuffer.prototype.slice?r=this._bufferView.buffer.slice(this.position(),this.position()+e):(r=new ArrayBuffer(e),t=new Uint8Array(r),n=new Uint8Array(this._bufferView.buffer,this.position(),e),t.set(n)),this.seek(e),r},seek:function(e){this._position+=e},peekUint32:function(){return this._bufferView.getUint32(this.position(),!0)},position:function(e){if(void 0===e)return this._position;this._position=e},size:function(){return this._bufferView.byteLength}},UntarFileStream.prototype={hasNext:function(){return this._stream.position()+4<this._stream.size()&&0!==this._stream.peekUint32()},next:function(){return this._readNextFile()},_readNextFile:function(){var e=this._stream,r=new TarFile,t=!1,n=null,a=e.position()+512;switch(r.name=e.readString(100),r.mode=e.readString(8),r.uid=parseInt(e.readString(8)),r.gid=parseInt(e.readString(8)),r.size=parseInt(e.readString(12),8),r.mtime=parseInt(e.readString(12),8),r.checksum=parseInt(e.readString(8)),r.type=e.readString(1),r.linkname=e.readString(100),r.ustarFormat=e.readString(6),-1<r.ustarFormat.indexOf("ustar")&&(r.version=e.readString(2),r.uname=e.readString(32),r.gname=e.readString(32),r.devmajor=parseInt(e.readString(8)),r.devminor=parseInt(e.readString(8)),r.namePrefix=e.readString(155),0<r.namePrefix.length)&&(r.name=r.namePrefix+"/"+r.name),e.position(a),r.type){case"0":case"":r.buffer=e.readBuffer(r.size);break;case"1":case"2":case"3":case"4":case"5":case"6":case"7":break;case"g":t=!0,this._globalPaxHeader=PaxHeader.parse(e.readBuffer(r.size));break;case"x":t=!0,n=PaxHeader.parse(e.readBuffer(r.size))}void 0===r.buffer&&(r.buffer=new ArrayBuffer(0));a+=r.size;return r.size%512!=0&&(a+=512-r.size%512),e.position(a),t&&(r=this._readNextFile()),null!==this._globalPaxHeader&&this._globalPaxHeader.applyHeader(r),null!==n&&n.applyHeader(r),r}};
