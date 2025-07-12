const CACHE_KEY = "wclap";
const PROXY_BASE = self.location.href + "/";

self.addEventListener("install", e => {
	self.skipWaiting(); // don't wait for all existing pages to close
})
self.addEventListener("activate", e => {
	e.waitUntil(clients.claim());
});

self.addEventListener("fetch", e => {
	let request = e.request;
	e.respondWith((async () => {
		if (request.method == 'GET' && request.url.startsWith(PROXY_BASE)) {
			request = new Request(request.url.replace(/\?.*/, ''));
			let cachedResponse = await caches.match(request);
			if (cachedResponse) return cachedResponse;
			
			let suffix = request.url.substr(PROXY_BASE.length);
			let suffixTrimmed = suffix.replace(/\/.*/, '');
			// next path component is .tar.gz URL, percent-encoded
			let bundleUrl = decodeURIComponent(suffixTrimmed);
			
			let tarResponse = await fetch(altRequest(bundleUrl));
			await addCacheFromTarGz(tarResponse, PROXY_BASE + suffixTrimmed + "/");

			// Check the cache again
			cachedResponse = await caches.match(request);
			return cachedResponse || new Response(null, {status: 404});
		} else {
			let cachedResponse = await caches.match(request);
			if (cachedResponse) return cachedResponse;
			return fetch(request);
		}
	})());

	function altRequest(url) {
		return new Request(url); // TODO: same credentials/etc
	}

	async function addCacheFromTarGz(tarResponse, baseUrl) {
		let stream = new DecompressionStream('gzip');
		stream = tarResponse.body.pipeThrough(stream);
		let arrayBuffer = await (new Response(stream)).arrayBuffer();
		
		let cache = await caches.open(CACHE_KEY);

		let tarFileStream = new UntarFileStream(arrayBuffer);
		let promises = [];
		while (tarFileStream.hasNext()) {
			let file = tarFileStream.next();
			if (file.type == '0' || file.type == "\0" || file.type == "") {
				let fileUrl = new URL(file.name, baseUrl).href;
				let fileRequest = altRequest(fileUrl);
				let fileExt = fileUrl.replace(/.*\./, '').toLowerCase();
				let fileResponse = new Response(file.buffer, {
					status: tarResponse.status,
					statusText: tarResponse.statusText,
					headers: {
						'Content-Type': ext2Mime[fileExt] || 'application/octet-stream'
					}
				});
				promises.push(cache.put(fileRequest, fileResponse));
			}
		}
		return Promise.all(promises);
	}
});

// data from https://github.com/jshttp/mime-db
let ext2Mime = {};
/* let packed = [];
for (let key in mimeDb) {
    if (!/\/(prs\.|vnd\.|x-)/.test(key) && mimeDb[key].extensions) {
        packed.push([key].concat(mimeDb[key].extensions))
    }
}
packed = packed.map(p => p.join(',')).join('|');
*/
"application/andrew-inset,ez|application/appinstaller,appinstaller|application/applixware,aw|application/appx,appx|application/appxbundle,appxbundle|application/atom+xml,atom|application/atomcat+xml,atomcat|application/atomdeleted+xml,atomdeleted|application/atomsvc+xml,atomsvc|application/atsc-dwd+xml,dwd|application/atsc-held+xml,held|application/atsc-rsat+xml,rsat|application/automationml-aml+xml,aml|application/automationml-amlx+zip,amlx|application/bdoc,bdoc|application/calendar+xml,xcs|application/ccxml+xml,ccxml|application/cdfx+xml,cdfx|application/cdmi-capability,cdmia|application/cdmi-container,cdmic|application/cdmi-domain,cdmid|application/cdmi-object,cdmio|application/cdmi-queue,cdmiq|application/cpl+xml,cpl|application/cu-seeme,cu|application/cwl,cwl|application/dash+xml,mpd|application/dash-patch+xml,mpp|application/davmount+xml,davmount|application/docbook+xml,dbk|application/dssc+der,dssc|application/dssc+xml,xdssc|application/ecmascript,ecma|application/emma+xml,emma|application/emotionml+xml,emotionml|application/epub+zip,epub|application/exi,exi|application/express,exp|application/fdf,fdf|application/fdt+xml,fdt|application/font-tdpfr,pfr|application/geo+json,geojson|application/gml+xml,gml|application/gpx+xml,gpx|application/gxf,gxf|application/gzip,gz|application/hjson,hjson|application/hyperstudio,stk|application/inkml+xml,ink,inkml|application/ipfix,ipfix|application/its+xml,its|application/java-archive,jar,war,ear|application/java-serialized-object,ser|application/java-vm,class|application/javascript,js|application/json,json,map|application/json5,json5|application/jsonml+json,jsonml|application/ld+json,jsonld|application/lgr+xml,lgr|application/lost+xml,lostxml|application/mac-binhex40,hqx|application/mac-compactpro,cpt|application/mads+xml,mads|application/manifest+json,webmanifest|application/marc,mrc|application/marcxml+xml,mrcx|application/mathematica,ma,nb,mb|application/mathml+xml,mathml|application/mbox,mbox|application/media-policy-dataset+xml,mpf|application/mediaservercontrol+xml,mscml|application/metalink+xml,metalink|application/metalink4+xml,meta4|application/mets+xml,mets|application/mmt-aei+xml,maei|application/mmt-usd+xml,musd|application/mods+xml,mods|application/mp21,m21,mp21|application/mp4,mp4,mpg4,mp4s,m4p|application/msix,msix|application/msixbundle,msixbundle|application/msword,doc,dot|application/mxf,mxf|application/n-quads,nq|application/n-triples,nt|application/node,cjs|application/octet-stream,bin,dms,lrf,mar,so,dist,distz,pkg,bpk,dump,elc,deploy,exe,dll,deb,dmg,iso,img,msi,msp,msm,buffer|application/oda,oda|application/oebps-package+xml,opf|application/ogg,ogx|application/omdoc+xml,omdoc|application/onenote,onetoc,onetoc2,onetmp,onepkg|application/oxps,oxps|application/p2p-overlay+xml,relo|application/patch-ops-error+xml,xer|application/pdf,pdf|application/pgp-encrypted,pgp|application/pgp-keys,asc|application/pgp-signature,sig,asc|application/pics-rules,prf|application/pkcs10,p10|application/pkcs7-mime,p7m,p7c|application/pkcs7-signature,p7s|application/pkcs8,p8|application/pkix-attr-cert,ac|application/pkix-cert,cer|application/pkix-crl,crl|application/pkix-pkipath,pkipath|application/pkixcmp,pki|application/pls+xml,pls|application/postscript,ai,eps,ps|application/provenance+xml,provx|application/pskc+xml,pskcxml|application/raml+yaml,raml|application/rdf+xml,rdf,owl|application/reginfo+xml,rif|application/relax-ng-compact-syntax,rnc|application/resource-lists+xml,rl|application/resource-lists-diff+xml,rld|application/rls-services+xml,rs|application/route-apd+xml,rapd|application/route-s-tsid+xml,sls|application/route-usd+xml,rusd|application/rpki-ghostbusters,gbr|application/rpki-manifest,mft|application/rpki-roa,roa|application/rsd+xml,rsd|application/rss+xml,rss|application/rtf,rtf|application/sbml+xml,sbml|application/scvp-cv-request,scq|application/scvp-cv-response,scs|application/scvp-vp-request,spq|application/scvp-vp-response,spp|application/sdp,sdp|application/senml+xml,senmlx|application/sensml+xml,sensmlx|application/set-payment-initiation,setpay|application/set-registration-initiation,setreg|application/shf+xml,shf|application/sieve,siv,sieve|application/smil+xml,smi,smil|application/sparql-query,rq|application/sparql-results+xml,srx|application/sql,sql|application/srgs,gram|application/srgs+xml,grxml|application/sru+xml,sru|application/ssdl+xml,ssdl|application/ssml+xml,ssml|application/swid+xml,swidtag|application/tei+xml,tei,teicorpus|application/thraud+xml,tfi|application/timestamped-data,tsd|application/toml,toml|application/trig,trig|application/ttml+xml,ttml|application/ubjson,ubj|application/urc-ressheet+xml,rsheet|application/urc-targetdesc+xml,td|application/voicexml+xml,vxml|application/wasm,wasm|application/watcherinfo+xml,wif|application/widget,wgt|application/winhlp,hlp|application/wsdl+xml,wsdl|application/wspolicy+xml,wspolicy|application/xaml+xml,xaml|application/xcap-att+xml,xav|application/xcap-caps+xml,xca|application/xcap-diff+xml,xdf|application/xcap-el+xml,xel|application/xcap-ns+xml,xns|application/xenc+xml,xenc|application/xfdf,xfdf|application/xhtml+xml,xhtml,xht|application/xliff+xml,xlf|application/xml,xml,xsl,xsd,rng|application/xml-dtd,dtd|application/xop+xml,xop|application/xproc+xml,xpl|application/xslt+xml,xsl,xslt|application/xspf+xml,xspf|application/xv+xml,mxml,xhvml,xvml,xvm|application/yang,yang|application/yin+xml,yin|application/zip,zip|audio/3gpp,3gpp|audio/aac,adts,aac|audio/adpcm,adp|audio/amr,amr|audio/basic,au,snd|audio/midi,mid,midi,kar,rmi|audio/mobile-xmf,mxmf|audio/mp3,mp3|audio/mp4,m4a,mp4a|audio/mpeg,mpga,mp2,mp2a,mp3,m2a,m3a|audio/ogg,oga,ogg,spx,opus|audio/s3m,s3m|audio/silk,sil|audio/wav,wav|audio/wave,wav|audio/webm,weba|audio/xm,xm|font/collection,ttc|font/otf,otf|font/ttf,ttf|font/woff,woff|font/woff2,woff2|image/aces,exr|image/apng,apng|image/avci,avci|image/avcs,avcs|image/avif,avif|image/bmp,bmp,dib|image/cgm,cgm|image/dicom-rle,drle|image/dpx,dpx|image/emf,emf|image/fits,fits|image/g3fax,g3|image/gif,gif|image/heic,heic|image/heic-sequence,heics|image/heif,heif|image/heif-sequence,heifs|image/hej2k,hej2|image/hsj2,hsj2|image/ief,ief|image/jls,jls|image/jp2,jp2,jpg2|image/jpeg,jpeg,jpg,jpe|image/jph,jph|image/jphc,jhc|image/jpm,jpm,jpgm|image/jpx,jpx,jpf|image/jxl,jxl|image/jxr,jxr|image/jxra,jxra|image/jxrs,jxrs|image/jxs,jxs|image/jxsc,jxsc|image/jxsi,jxsi|image/jxss,jxss|image/ktx,ktx|image/ktx2,ktx2|image/png,png|image/sgi,sgi|image/svg+xml,svg,svgz|image/t38,t38|image/tiff,tif,tiff|image/tiff-fx,tfx|image/webp,webp|image/wmf,wmf|message/disposition-notification,disposition-notification|message/global,u8msg|message/global-delivery-status,u8dsn|message/global-disposition-notification,u8mdn|message/global-headers,u8hdr|message/rfc822,eml,mime|model/3mf,3mf|model/gltf+json,gltf|model/gltf-binary,glb|model/iges,igs,iges|model/jt,jt|model/mesh,msh,mesh,silo|model/mtl,mtl|model/obj,obj|model/prc,prc|model/step+xml,stpx|model/step+zip,stpz|model/step-xml+zip,stpxz|model/stl,stl|model/u3d,u3d|model/vrml,wrl,vrml|model/x3d+binary,x3db,x3dbz|model/x3d+fastinfoset,x3db|model/x3d+vrml,x3dv,x3dvz|model/x3d+xml,x3d,x3dz|model/x3d-vrml,x3dv|text/cache-manifest,appcache,manifest|text/calendar,ics,ifb|text/coffeescript,coffee,litcoffee|text/css,css|text/csv,csv|text/html,html,htm,shtml|text/jade,jade|text/javascript,js,mjs|text/jsx,jsx|text/less,less|text/markdown,md,markdown|text/mathml,mml|text/mdx,mdx|text/n3,n3|text/plain,txt,text,conf,def,list,log,in,ini|text/richtext,rtx|text/rtf,rtf|text/sgml,sgml,sgm|text/shex,shex|text/slim,slim,slm|text/spdx,spdx|text/stylus,stylus,styl|text/tab-separated-values,tsv|text/troff,t,tr,roff,man,me,ms|text/turtle,ttl|text/uri-list,uri,uris,urls|text/vcard,vcard|text/vtt,vtt|text/wgsl,wgsl|text/xml,xml|text/yaml,yaml,yml|video/3gpp,3gp,3gpp|video/3gpp2,3g2|video/h261,h261|video/h263,h263|video/h264,h264|video/iso.segment,m4s|video/jpeg,jpgv|video/jpm,jpm,jpgm|video/mj2,mj2,mjp2|video/mp2t,ts,m2t,m2ts,mts|video/mp4,mp4,mp4v,mpg4|video/mpeg,mpeg,mpg,mpe,m1v,m2v|video/ogg,ogv|video/quicktime,qt,mov|video/webm,webm".split('|').forEach(p => {
	p = p.split(',');
	p.slice(1).forEach(ext => ext2Mime[ext] = p[0]);
});

// Taken from js-untar: https://github.com/InvokIT/js-untar/blob/master/src/untar-worker.js @license MIT
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
function UntarWorker(){}var worker;function decodeUTF8(e){if("function"==typeof TextDecoder)return(new TextDecoder).decode(e);for(var r="",t=0;t<e.length;){var n=e[t++];if(127<n){if(191<n&&n<224){if(e.length<=t)throw"UTF-8 decode: incomplete 2-byte sequence";n=(31&n)<<6|63&e[t]}else if(223<n&&n<240){if(e.length<=t+1)throw"UTF-8 decode: incomplete 3-byte sequence";n=(15&n)<<12|(63&e[t])<<6|63&e[++t]}else{if(!(239<n&&n<248))throw"UTF-8 decode: unknown multibyte start 0x"+n.toString(16)+" at index "+(t-1);if(e.length<=t+2)throw"UTF-8 decode: incomplete 4-byte sequence";n=(7&n)<<18|(63&e[t])<<12|(63&e[++t])<<6|63&e[++t]}++t}if(n<=65535)r+=String.fromCharCode(n);else{if(!(n<=1114111))throw"UTF-8 decode: code point 0x"+n.toString(16)+" exceeds UTF-16 reach";n-=65536,r=(r+=String.fromCharCode(n>>10|55296))+String.fromCharCode(1023&n|56320)}}return r}function PaxHeader(e){this._fields=e}function TarFile(){}function UntarStream(e){this._bufferView=new DataView(e),this._position=0}function UntarFileStream(e){this._stream=new UntarStream(e),this._globalPaxHeader=null}UntarWorker.prototype={onmessage:function(e){try{if("extract"!==e.data.type)throw new Error("Unknown message type: "+e.data.type);this.untarBuffer(e.data.buffer)}catch(e){this.postError(e)}},postError:function(e){this.postMessage({type:"error",data:{message:e.message}})},postLog:function(e,r){this.postMessage({type:"log",data:{level:e,msg:r}})},untarBuffer:function(e){try{for(var r=new UntarFileStream(e);r.hasNext();){var t=r.next();this.postMessage({type:"extract",data:t},[t.buffer])}this.postMessage({type:"complete"})}catch(e){this.postError(e)}},postMessage:function(e,r){self.postMessage(e,r)}},"undefined"!=typeof self&&(worker=new UntarWorker,self.onmessage=function(e){worker.onmessage(e)}),PaxHeader.parse=function(e){for(var r=new Uint8Array(e),t=[];0<r.length;){var n=parseInt(decodeUTF8(r.subarray(0,r.indexOf(32)))),a=decodeUTF8(r.subarray(0,n)).match(/^\d+ ([^=]+)=((.|\r|\n)*)\n$/);if(null===a)throw new Error("Invalid PAX header data format.");var i=a[1],a=a[2],i=(0===a.length?a=null:null!==a.match(/^\d+$/)&&(a=parseInt(a)),{name:i,value:a});t.push(i),r=r.subarray(n)}return new PaxHeader(t)},PaxHeader.prototype={applyHeader:function(t){this._fields.forEach(function(e){var r=e.name,e=e.value;"path"===r?(r="name",void 0!==t.prefix&&delete t.prefix):"linkpath"===r&&(r="linkname"),null===e?delete t[r]:t[r]=e})}},UntarStream.prototype={readString:function(e){for(var r=+e,t=[],n=0;n<e;++n){var a=this._bufferView.getUint8(this.position()+ +n,!0);if(0===a)break;t.push(a)}return this.seek(r),String.fromCharCode.apply(null,t)},readBuffer:function(e){var r,t,n;return"function"==typeof ArrayBuffer.prototype.slice?r=this._bufferView.buffer.slice(this.position(),this.position()+e):(r=new ArrayBuffer(e),t=new Uint8Array(r),n=new Uint8Array(this._bufferView.buffer,this.position(),e),t.set(n)),this.seek(e),r},seek:function(e){this._position+=e},peekUint32:function(){return this._bufferView.getUint32(this.position(),!0)},position:function(e){if(void 0===e)return this._position;this._position=e},size:function(){return this._bufferView.byteLength}},UntarFileStream.prototype={hasNext:function(){return this._stream.position()+4<this._stream.size()&&0!==this._stream.peekUint32()},next:function(){return this._readNextFile()},_readNextFile:function(){var e=this._stream,r=new TarFile,t=!1,n=null,a=e.position()+512;switch(r.name=e.readString(100),r.mode=e.readString(8),r.uid=parseInt(e.readString(8)),r.gid=parseInt(e.readString(8)),r.size=parseInt(e.readString(12),8),r.mtime=parseInt(e.readString(12),8),r.checksum=parseInt(e.readString(8)),r.type=e.readString(1),r.linkname=e.readString(100),r.ustarFormat=e.readString(6),-1<r.ustarFormat.indexOf("ustar")&&(r.version=e.readString(2),r.uname=e.readString(32),r.gname=e.readString(32),r.devmajor=parseInt(e.readString(8)),r.devminor=parseInt(e.readString(8)),r.namePrefix=e.readString(155),0<r.namePrefix.length)&&(r.name=r.namePrefix+"/"+r.name),e.position(a),r.type){case"0":case"":r.buffer=e.readBuffer(r.size);break;case"1":case"2":case"3":case"4":case"5":case"6":case"7":break;case"g":t=!0,this._globalPaxHeader=PaxHeader.parse(e.readBuffer(r.size));break;case"x":t=!0,n=PaxHeader.parse(e.readBuffer(r.size))}void 0===r.buffer&&(r.buffer=new ArrayBuffer(0));a+=r.size;return r.size%512!=0&&(a+=512-r.size%512),e.position(a),t&&(r=this._readNextFile()),null!==this._globalPaxHeader&&this._globalPaxHeader.applyHeader(r),null!==n&&n.applyHeader(r),r}};
