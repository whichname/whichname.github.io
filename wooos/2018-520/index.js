/**
 * Created by wzm on 2018/5/10.
 */
'use strict';

function pushHistory() {
    var state = {
        title: "物只卤鹅520",
        url: "#"
    };
    window.history.pushState(state, "title", "#");
}

var mAlloyCrop;
var mBase64;
var mName = "五月一", mMsg = "一起去物只卤鹅吃鸡吧啊啊啊啊啊啊啊啊啊啊啊啊啊";
var mAvatar = "img/wooos.jpeg";
var mClipW, mClipH;//剪切大小
var mPostRatio;//海报比裁剪范围的倍数
var mPageTranTime = 350;
var mLoading;


function showLoading(des) {
    if(mLoading) {
        mLoading.hide();
        mLoading = null;
    }
    mLoading = weui.loading(des);
}
function hideLoading() {
    if(mLoading) {
        mLoading.hide();
        mLoading = null;
    }
}

$(document).ready(function () {
    $('.page').css('height', window.innerHeight);
    $('#page-clip').css('height', window.innerHeight);
    $('.bg-post').css('height', $('.bg-post').width()*733/423);
    $('#img-post').css('height', $('.bg-post').width()*390/423);
    $('#img-post').css('height', $('.bg-post').height()*720/733);
    $('.save').css('height', $('.save').width()*202/724);

//    关闭弹窗事件
    $('body').click(function () {
        if($('.list-msg').is(':visible')) {
            $('.list-msg').hide();
        }
    });

//    第一页事件
    $('#btn-create-now').click(btnCreateNowClick);

//    信息页事件
    $('.icon-img').css('width', $('.icon-img').height()*9/16);
    $('.btn-down').click(btnDownClick);
    $('.item-msg').click(itemMsgClick);
    $('.icon-img').click(chooseImgClick);
    $('#btn-create-post').click(btnCreatePostClick);

    window.addEventListener("popstate", function(e) {
        //如果当前为第二页的编辑图片
        if(mAlloyCrop != null) {
            mAlloyCrop.destroy();
            mAlloyCrop=null;
        }
    }, false);
});



/**第一页*/
function btnCreateNowClick() {
    $('#page-launch').css('top', '-100%');
    $('#page-info').css('top', '0');
    setTimeout(function () {
        $('#page-launch').remove();
    }, mPageTranTime);
}

/**信息页*/
//打开预设情话
function btnDownClick() {
    $('.list-msg').toggle();
    return false;
}
//预设情话
function itemMsgClick() {
    $('.input-msg').val($(this).text());
}
//获得图片
function chooseImgClick() {
    // wx.chooseImage({
    //     count: 1, // 默认9
    //     sizeType: ['original'], // 可以指定是原图还是压缩图，默认二者都有
    //     sourceType: ['album', 'camera'], // 可以指定来源是相册还是相机，默认二者都有
    //     success: function (res) {
    //         var localIds = res.localIds; // 返回选定照片的本地ID列表，localId可以作为img标签的src属性显示图片
    //         //加载图片
    //
    //
    //     }
    // });
    openClipPage('img/img.png');
    pushHistory();
}
//图片点击
function imgClick() {
    $('.icon-img').click();
}
//生成海报点击
function btnCreatePostClick() {
    //检查
    // mName = $('.input-name').val();
    // if(!mName) return weui.dialog({
    //     content: '请输入昵称',
    //     buttons: [{
    //         label: '确定',
    //         type: 'primary'
    //     }]
    // });
    // mMsg = $('.input-msg').val();
    // if(!mName) return weui.dialog({
    //     content: '请输入情话',
    //     buttons: [{
    //         label: '确定',
    //         type: 'primary'
    //     }]
    // });
    // if(!mBase64) return weui.dialog({
    //     content: '请选择一张图片',
    //     buttons: [{
    //         label: '确定',
    //         type: 'primary'
    //     }]
    // });

    //生成海报
    createPost();
}
//去结果页
function toResultPage() {
    $('#page-info').css('top', '-100%');
    $('#page-result').css('top', '0');
    setTimeout(function () {
        $('#page-info').remove();
    }, mPageTranTime);
}

/**截图页*/
function openClipPage(imgSrc) {
    //计算剪切大小
    mClipW = window.innerWidth*0.6;
    mClipH = mClipW*16/9;
    //如果height大于window.innerHeight*0.8,
    if(mClipH > window.innerHeight*0.8) {
        mClipH = window.innerHeight*0.8;
        mClipW = mClipH*9/16;
    }
    mPostRatio = 1080/mClipW > 1920/mClipH ? 1080/mClipW : 1920/mClipH;
    mAlloyCrop = new AlloyCrop({
        image_src: imgSrc,
        width: mClipW,
        height: mClipH,
        output: mPostRatio,
        ok: function (base64, canvas) {
            mBase64 = base64;
            canvas.addEventListener('click', imgClick);
            $('.input-img').append(canvas);
            mAlloyCrop.destroy();
            mAlloyCrop = null;
            window.history.back();
            hideLoading();
        },
        preOk: function () {
            showLoading("正在处理...");
        }
    });
}

/**结果页*/
var mImgClip, mImgAvatar, mImgMask;
var mImgLoadedCount = 0;//图片加载计数
function createPost() {
    showLoading("正在生成...");
    mImgClip = new Image();
    mImgClip.onload = imgLoad;
    mImgClip.src = mBase64;
    mImgAvatar = new Image();
    mImgAvatar.onload = imgLoad;
    mImgAvatar.src = mAvatar;
    mImgMask = new Image();
    mImgMask.onload = imgLoad;
    mImgMask.src = 'img/post_mask.png';
}
function imgLoad() {
    mImgLoadedCount++;
    if(mImgLoadedCount < 3) return;
    var canvas = document.createElement('canvas');
    var canvasW = mClipW*mPostRatio, canvasH = mClipH*mPostRatio;
    canvas.width = canvasW;
    canvas.height = canvasH;
    var ctx = canvas.getContext('2d');
    //画图
    ctx.drawImage(mImgClip, 0, 0, canvasW, canvasH);
    //画头像框
    ctx.save();
    var x = canvasW*815/900;
    var y = canvasH*472/1600;
    var r = (canvasW*120/900)/2;
    ctx.strokeStyle = "white";
    ctx.lineWidth = canvasW*10/900;
    ctx.arc(x, y, (canvasW*120/960)/2, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
    //画头像
    ctx.save();
    ctx.arc(x, y, (canvasW*120/960)/2, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(mImgAvatar, 0, 0, mImgAvatar.width, mImgAvatar.height, x-r, y-r, canvasW*120/900, canvasW*120/900);
    ctx.restore();
    //画名字
    ctx.save();
    ctx.fillStyle = "White";
    ctx.font = "700 "+canvasH*50/1600 + "px Heiti SC";
    x = canvasW*24/900;
    y = canvasH*1155/1600 + canvasH*50/1600;
    ctx.fillText("@"+mName, x, y);
    ctx.restore();
    //画情话
    ctx.save();
    ctx.fillStyle = "White";
    ctx.font = canvasH*45/1600 + "px Heiti SC";
    x = canvasW*24/900;
    y = canvasH*1230/1600 + canvasH*45/1600;
    var maxWidth = canvasW*520/900;
    var fontSize = canvasH*45/1600;
    drawMsg(ctx, mMsg, x, y, maxWidth, fontSize);
    ctx.restore();

    //画最上层
    ctx.drawImage(mImgMask, 0, 0, mImgMask.width, mImgMask.height, 0, 0, canvasW, canvasH);

    $('#img-post').attr('src', canvas.toDataURL('data/jpeg'));

    toResultPage();
    hideLoading();
}

//画情话
function drawMsg(ctx, msg, x, y, maxWidth, fontSize) {
    var chr = msg.split("");
    var temp = "";
    var row = [];

    for(var a = 0; a < chr.length; a++){
        if( ctx.measureText(temp).width < maxWidth ){
        }
        else{
            row.push(temp);
            temp = "";
        }
        temp += chr[a];
    }
    row.push(temp);
    for(var b = 0; b < row.length; b++){
        ctx.fillText(row[b],x,y+b*fontSize+b*fontSize*0.2);
    }
}


