// QR Code Service
angular.module('karaApp').service('QRCodeService', [
    function() {
        // Generate QR code URL using Google Charts API
        this.generateQRCode = function(roomId, roomName) {
            var baseUrl = window.location.origin + window.location.pathname;
            var customerUrl = baseUrl + '#/customer?room=' + roomId;
            
            // Use Google Charts QR Code API
            var qrCodeUrl = 'https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=' + encodeURIComponent(customerUrl);
            
            return {
                roomId: roomId,
                roomName: roomName,
                url: customerUrl,
                qrCodeImageUrl: qrCodeUrl
            };
        };
        
        // Generate QR codes for all rooms
        this.generateAllQRCodes = function(rooms) {
            return rooms.map(room => this.generateQRCode(room.id, room.name));
        };
        
        // Print QR code (open in new window)
        this.printQRCode = function(qrData) {
            var printWindow = window.open('', '', 'width=400,height=500');
            printWindow.document.write('<html><head><title>QR Code - ' + qrData.roomName + '</title>');
            printWindow.document.write('<style>');
            printWindow.document.write('body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }');
            printWindow.document.write('h1 { color: #333; margin-bottom: 10px; }');
            printWindow.document.write('img { border: 2px solid #333; padding: 10px; margin: 20px 0; }');
            printWindow.document.write('p { color: #666; font-size: 14px; }');
            printWindow.document.write('.url { font-size: 10px; word-break: break-all; color: #999; }');
            printWindow.document.write('</style>');
            printWindow.document.write('</head><body>');
            printWindow.document.write('<h1>' + qrData.roomName + '</h1>');
            printWindow.document.write('<p>Quét mã để gọi món</p>');
            printWindow.document.write('<img src="' + qrData.qrCodeImageUrl + '" alt="QR Code">');
            printWindow.document.write('<p class="url">' + qrData.url + '</p>');
            printWindow.document.write('<p style="margin-top: 30px; font-size: 12px;">Hệ thống Karaoke Management</p>');
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            
            setTimeout(function() {
                printWindow.print();
            }, 250);
        };
        
        // Print all QR codes
        this.printAllQRCodes = function(qrDataList) {
            var printWindow = window.open('', '', 'width=800,height=600');
            printWindow.document.write('<html><head><title>QR Codes - Tất cả phòng</title>');
            printWindow.document.write('<style>');
            printWindow.document.write('body { font-family: Arial, sans-serif; padding: 20px; }');
            printWindow.document.write('.qr-container { display: inline-block; width: 45%; margin: 10px; text-align: center; border: 1px solid #ddd; padding: 15px; page-break-inside: avoid; }');
            printWindow.document.write('h2 { color: #333; margin: 0 0 10px 0; font-size: 18px; }');
            printWindow.document.write('img { border: 2px solid #333; padding: 5px; width: 200px; height: 200px; }');
            printWindow.document.write('p { color: #666; font-size: 12px; margin: 5px 0; }');
            printWindow.document.write('@media print { .qr-container { page-break-inside: avoid; } }');
            printWindow.document.write('</style>');
            printWindow.document.write('</head><body>');
            printWindow.document.write('<h1 style="text-align: center;">QR Codes - Tất cả phòng</h1>');
            
            qrDataList.forEach(function(qrData) {
                printWindow.document.write('<div class="qr-container">');
                printWindow.document.write('<h2>' + qrData.roomName + '</h2>');
                printWindow.document.write('<img src="' + qrData.qrCodeImageUrl + '" alt="QR Code">');
                printWindow.document.write('<p>Quét mã để gọi món</p>');
                printWindow.document.write('</div>');
            });
            
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            
            setTimeout(function() {
                printWindow.print();
            }, 500);
        };
    }
]);
