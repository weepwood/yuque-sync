var https = require('follow-redirects').https;
var fs = require('fs');

var options = {
    'method': 'POST',
    'hostname': 'www.yuque.com',
    'path': '/api/upload/attach',
    'headers': {
        'Referer': 'https://www.yuque.com',
        'Cookie': 'cookie=receive-cookie-deprecation=1; lang=zh-cn; _uab_collina=173112094991807440099133; receive-cookie-deprecation=1; _tea_utm_cache_20001731={%22utm_source%22:%22ld246.com%22}; _yuque_session=Wp4jcnzLxQz_Ipaz8d5WOKiEcGqnYOd0jF_u6u4Ocu8IbOJ0qJ4YRl3lu-nfgxo0e4_9yc2DrIjUH2EMqDFiTA==; tfstk=gYLjN6tOPdLzf8wkixhPNHKJV_b6cdgUh519tCU46ZQYBRddUSrV0sz6Vdpl0tpNuRg6FZIM0OWVCNOMdbkE82RDiNbqLvuU08FeYwVYWieNw7CC5shckkM9iNbtU7ztY2ODpoOpgFQtNaC19-QTDih7e6W8k1UA68h5sTQO6PUTyaCOtsBTDdd-N1XRBNQt6hNC1m6DGjp2vdbIpodCFPU9P_HGBIwgXTxRGa6pME9kUUaOc9dAFPkBIWWRe6T-I-WMPQLAsL3zlNOR1p_vVYUXCIKHI6pxP-CXDBOFVFDL5_xJng5XVfERHBB5kTTisPXv0CLNfEHL_tLD3UsHS-MPQHRykg9KUz9GfnKdkFMIygSg89_qIlN5xP15LbG7jljKnSCTr5HXSiClGglSN-KGD_f5ZbG7jljAZ_zsNbwvj; aliyungf_tc=c9abd5c69e5bb19b4ecefca42c83198bfb1242af36e0e872b1cd8874c084c201; yuque_ctoken=DxBOK1gOwW0Bcl1HkO4NPTBL; current_theme=default; acw_tc=ac11000117426484784368803e14fcae9bc33f9b16246248e7f78b5f51b6d6; aliyungf_tc=8258b881bbcf18f27003f8c0d38107d497084963f587ff8c22c5d4472ab3b0da; yuque_ctoken=_uRHARQeB0OOwN1Tbn74RezC; lang=zh-cn; _yuque_session=5ZBHoRQuNa9Cir_GW-U-6cYSMK39Vajf0YLdxspM_VewgPc7YKTZlfW5DHlpjvKnxKWqf0dTP7GQqsBAMx9Lhw==',
        'User-Agent': 'Apifox/1.0.0 (https://apifox.com)',
        'X-Auth-Token': '8pWNuBSOTMYIQe7R5E8hVs8ngb0frjeJUEd4TmOO',
        'Accept': '*/*',
        'Host': 'www.yuque.com',
        'Connection': 'keep-alive',
        'Content-Type': 'multipart/form-data; boundary=--------------------------255533913370571804669949'
    },
    'maxRedirects': 20
};

var req = https.request(options, function (res) {
    var chunks = [];

    res.on("data", function (chunk) {
        chunks.push(chunk);
    });

    res.on("end", function (chunk) {
        var body = Buffer.concat(chunks);
        console.log(body.toString());
    });

    res.on("error", function (error) {
        console.error(error);
    });
});

var postData = "------WebKitFormBoundary7MA4YWxkTrZu0gW\r\nContent-Disposition: form-data; name=\"file\"; filename=\"avatar.jpg\"\r\nContent-Type: \"{Insert_File_Content_Type}\"\r\n\r\n" + fs.readFileSync('/Users/weepwood/Pictures/avatar.jpg') + "\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW--";

req.setHeader('content-type', 'multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW');

req.write(postData);

req.end();