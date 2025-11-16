/* This is a Service Worker which allows web pages to provide their own resources, under a scoped path prefix.

When included with <script> it registers itself as a service worker, and defines the global `pageProxyReady` Promise.
This resolves to the "page proxy" object:
	{
		prefix: "https://some/url/prefix/",
		getResource: (path => [Blob/null])
	}
The `getResource()` function can be replaced, but the default uses t
Therefore, if you want to fill an `<iframe>` with custom content without worrying about lifecycle stuff, give it an ID and place that after the proxy prefix, like:
	<iframe id="my-iframe" src="{pageProxy.prefix}/my-iframe/...">
Then assign a lookup function:
	iframe[proxy.symbol] = (path => ...)
*/
if (typeof ServiceWorkerGlobalScope !== "function") {
	// Included via <script> - register itself as a service worker
	this.pageProxyReady = (async serviceWorker => {
		let scriptUrl = document.currentScript?.src;
		if (!serviceWorker.controller) {
			// either there's no controller (no registrations), or it's a hard-refresh (existing registrations will be bypassed, so remove them)
			const registrations = await serviceWorker.getRegistrations();
			await Promise.all(registrations.map(r => r.unregister()));

			await serviceWorker.register(scriptUrl || "./page-proxy-service-worker.js", {updateViaCache: 'all'});
		}
		let proxy = {
			symbol: Symbol("page-proxy"),
			prefix: "",
			// This can be replaced with your own implementation
			getResource(path) {
				// Default: use the first path component as an element ID, and look for `proxy.symbol` to resolve it
				let id = path.substr(1).replace(/[/?#].*/, '');
				let element = document.getElementById(id);
				if (!element || !element[proxy.symbol]) return null;
				
				path = path.substr(id.length + 1);
				return element[proxy.symbol](path);
			}
		};
		// Poll until it's ready (takes a bit longer on hard refresh)
		return new Promise(pass => {
			serviceWorker.addEventListener("message", async e => {
				if (e.data.request) {
					let resource = await proxy.getResource(e.data.path);
					if (!(resource instanceof Blob)) {
						let ext = e.data.path.replace(/[?#].*/, '').replace(/^.*\//, '').replace(/.*\./, '').toLowerCase();
						resource = new Blob([resource], {type: ext2Mime[ext]});
					}
					serviceWorker.controller.postMessage({
						request: e.data.request,
						resource: resource
					});
				} else if (e.data['page-proxy-prefix']) {
					proxy.prefix = e.data['page-proxy-prefix'];
					return pass(proxy);
				}
			});
			serviceWorker.addEventListener("controllerchange", e => {
				// Re-register if the service worker changes - this ideally shouldn't happen, but this is the best we can do
				return serviceWorker.controller.postMessage("page-proxy");
			});
			
			let ms = 10;
			function check() {
				if (serviceWorker.controller) {
					return serviceWorker.controller.postMessage("page-proxy");
				}
				console.log("waiting for serviceWorker");
				if (ms > 100) return location.reload(); // If there's another tab open still holding onto the previous registration, we'd wait forever, so just refresh again
				setTimeout(check, ms += 10);
			}
			check();
		});
	})(navigator.serviceWorker);
} else {
	// The actual Service Worker

	self.addEventListener("install", e => {
		self.skipWaiting(); // don't wait for all existing pages to close
	})
	self.addEventListener("activate", e => {
		//e.waitUntil(clients.claim()); // claim existing pages
	});

	const PROXY_BASE = self.location.href + "/";
	let requestMap = Object.create(null);
	self.addEventListener("message", e => {
		if (e.data == "page-proxy") {
			e.source.postMessage({"page-proxy-prefix": PROXY_BASE + e.source.id + "/"});
		} else if (e.data.request) {
			requestMap[e.data.request]?.(e.data.resource);
			delete requestMap[e.data.request];
		} else {
			console.error("unknown Service Worker message:", e.data);
		}
	});

	self.addEventListener("fetch", e => {
		let request = e.request;
		e.respondWith((async () => {
			if (request.method == 'GET' && request.url.startsWith(PROXY_BASE)) {
				let url = request.url.substr(PROXY_BASE.length);
				let clientId = url.replace(/\/.*/, '');
				let path = url.substr(clientId.length);
				
				let client = await self.clients.get(clientId);
				if (!client) return new Response(null, {status: 500});
				let requestId = crypto.randomUUID();
				return new Promise(pass => {
					requestMap[requestId] = blobOrNull => {
						if (blobOrNull) {
							if (0) false;
							return pass(new Response(blobOrNull));
						}
						pass(new Response(null, {status: 404}));
					};
					client.postMessage({
						request: requestId,
						path: path
					});
				});
			} else {
				let cachedResponse = await caches.match(request);
				if (cachedResponse) return cachedResponse;
				return fetch(request);
			}
		})());
	});
}

// A more densely-packed version of https://github.com/jshttp/mime-db @license MIT
/*
(The MIT License)

Copyright (c) 2014 Jonathan Ong <me@jongleberry.com>
Copyright (c) 2015-2022 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
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
