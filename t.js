const fs = require('fs');
const FormData = require('form-data'); // 使用 form-data 模块
const axios = require('axios');
const { log } = require('console');

// 图片文件路径
const filePath = './1234.png';

// 创建 FormData 实例
const form = new FormData();
form.append('file', fs.createReadStream(filePath)); // 使用文件流


// 发送 POST 请求
// axios.post('https://www.yuque.com/api/upload/attach', form, {
//     headers: {
//         'Cookie': "receive-cookie-deprecation=1; lang=zh-cn; _uab_collina=173112094991807440099133; receive-cookie-deprecation=1; _tea_utm_cache_20001731={%22utm_source%22:%22ld246.com%22}; _yuque_session=Wp4jcnzLxQz_Ipaz8d5WOKiEcGqnYOd0jF_u6u4Ocu8IbOJ0qJ4YRl3lu-nfgxo0e4_9yc2DrIjUH2EMqDFiTA==; tfstk=gYLjN6tOPdLzf8wkixhPNHKJV_b6cdgUh519tCU46ZQYBRddUSrV0sz6Vdpl0tpNuRg6FZIM0OWVCNOMdbkE82RDiNbqLvuU08FeYwVYWieNw7CC5shckkM9iNbtU7ztY2ODpoOpgFQtNaC19-QTDih7e6W8k1UA68h5sTQO6PUTyaCOtsBTDdd-N1XRBNQt6hNC1m6DGjp2vdbIpodCFPU9P_HGBIwgXTxRGa6pME9kUUaOc9dAFPkBIWWRe6T-I-WMPQLAsL3zlNOR1p_vVYUXCIKHI6pxP-CXDBOFVFDL5_xJng5XVfERHBB5kTTisPXv0CLNfEHL_tLD3UsHS-MPQHRykg9KUz9GfnKdkFMIygSg89_qIlN5xP15LbG7jljKnSCTr5HXSiClGglSN-KGD_f5ZbG7jljAZ_zsNbwvj; aliyungf_tc=c9abd5c69e5bb19b4ecefca42c83198bfb1242af36e0e872b1cd8874c084c201; yuque_ctoken=DxBOK1gOwW0Bcl1HkO4NPTBL; current_theme=default; acw_tc=ac11000117426484784368803e14fcae9bc33f9b16246248e7f78b5f51b6d6",
//         'Referer': 'https://www.yuque.com',
//         'Origin': 'https://www.yuque.com',
//         ...form.getHeaders(), // 获取 multipart/form-data 的头部信息
//     },
// })
//     .then(response => {
//         console.log('上传成功:', response.data);
//     })
//     .catch(error => {
//         console.error('上传失败:', error.response ? error.response.data : error.message);
//     });