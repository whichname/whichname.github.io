/**
 * Created by wzm on 2018/1/25.
 */
'use strict';

/**
 * 结果数组
 *  {
 *  img: 图片地址,
 *  xText: 文字的x轴位置,
 *  yText: 文字的y轴位置,
 *  font: 字体
 *  }
 * **/
var mImgsResult = [
    {
        img: 'img/result/result_01.png'
    },
    {
        img: 'img/result/result_02.png'
    },
    {
        img: 'img/result/result_03.png'
    },
    {
        img: 'img/result/result_04.png'
    },
    {
        img: 'img/result/result_05.png'
    },
    {
        img: 'img/result/result_06.png'
    },
    {
        img: 'img/result/result_07.png'
    },
    {
        img: 'img/result/result_08.png'
    },
    {
        img: 'img/result/result_09.png'
    },
    {
        img: 'img/result/result_10.png'
    },
    {
        img: 'img/result/result_11.png'
    },
    {
        img: 'img/result/result_12.png'
    }
];

/**默认的字体*/
var mDefaultFont = "26px Arial";
/**默认的字体位置*/
var mXText = 180;//这个是中点
var mYText = 260;

/**页面切换的动画时间，ms*/
var mTimePageChange = 250;

/************************以上为配置****************************************/

var loading;

function pushHistory() {
    var state = {
        title: "物只卤鹅2018新年签",
        url: "#"
    };
    window.history.pushState(state, "title", "#");
}

$(document).ready(function () {

    $('#pickerYear').click(mListenerClickYear);
    $('#submit').click(mListenerClickSubmit);


    window.addEventListener("popstate", function(e) {
        //如果当前为第二页
        if($('#resultRoot').css('bottom') == '0' || $('#resultRoot').css('bottom') == '0px') {
            //第一页滑入，第二页滑出
            $('#selectRoot').css('bottom', "0");
            $('#resultRoot').css('bottom', "-100%");
        }

    }, false);

});

/**年龄**/
//年龄选择器数据
var mDatasYear = [];
for (var i = 1949; i <= 2018; i++) {
    mDatasYear.push({
        label: i,
        value: i
    });
}
//年龄选择器配置
var mOptYear = {
    defaultValue: [1990],
    onConfirm: mListenerConfirmYear
}
//年龄选择器监听
function mListenerClickYear() {
    weui.picker(mDatasYear, mOptYear);
}
//年龄选择器确定监听
function mListenerConfirmYear(res) {
    if (res && res.length > 0)
        $('#pickerYear').val(res[0].label);
    $('#pickerYear').removeClass('input-placeholder');
}

/**抽签**/
function mListenerClickSubmit(node) {
    //姓名
    var name = $('#name').val();
    if (!name) return weui.toast('请输入姓名');
    //年龄
    var year = $('#pickerYear').val();
    if (!year || $('#pickerYear').hasClass('input-placeholder')) return weui.toast('请选择生日');
    //显示加载中
    loading = weui.loading('天灵灵地灵灵...');
    //抽签
    var tmp = 0;
    for (var i = 0; i < name.length; i++) {
        tmp += name.charCodeAt(i);
    }
    tmp += year*1;
    var resultIndex = tmp % mImgsResult.length;
    toResultPage(name, mImgsResult[resultIndex]);
}


/**结果页*/
function toResultPage(name, resultObj) {
    //生成canvas
    var canvas = document.createElement('canvas');
    var img = new Image();
    img.src = resultObj.img;
    img.onload = function () {
        //设置宽高
        canvas.width = img.width;
        canvas.height = img.height;
        //画图片
        var context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, img.width, img.height);
        //画名字
        context.font = resultObj.font ? resultObj.font : mDefaultFont;
        //计算名字长度
        var nameW = context.measureText(name).width;
        //名字的x轴
        var nameX = resultObj.xText ? resultObj.xText : mXText;
        nameX = nameX - nameW/2;
        context.fillText(name, nameX, resultObj.yText ? resultObj.yText : mYText);

        var imgData = canvas.toDataURL('png');

        //生成img节点
        var wh = computeWH(img.width, img.height);
        var imgNode = new Image();
        imgNode.src = imgData;
        imgNode.width = wh.width;
        imgNode.height = wh.height;

        $('#result-img-root').html(imgNode);

        if(loading) {
            loading.hide();
            loading = null;
        }

        //第一页滑出，第二页滑入
        $('#selectRoot').css('bottom', "100%");
        $('#resultRoot').css('bottom', "0");

        //按返回键可以回到第一页
        pushHistory();

    }
}


/**计算图片节点的宽高*/
function computeWH(imgW, imgH) {
    //以宽度为准的图片宽高
    var width = window.innerWidth*0.73;
    var height = width*imgH/imgW;
    //如果计算出的高度大于最大高度，重新以高度为准计算宽高
    if(height > window.innerHeight*0.73) {
        console.log("compute WH by windowH");
        height = window.innerHeight*0.73;
        width = height*imgW/imgH;
    }
    return {
        width: width,
        height: height
    };
}



