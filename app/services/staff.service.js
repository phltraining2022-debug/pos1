// Staff Service
angular.module('karaApp').service('StaffService', ['StorageService', 
    function(StorageService) {
        var checklists = [];
        
        this.getCleaningChecklist = function(roomId) {
            return {
                roomId: roomId,
                items: [
                    { id: 1, name: 'Kiểm tra Micro', checked: false },
                    { id: 2, name: 'Kiểm tra Loa', checked: false },
                    { id: 3, name: 'Kiểm tra Màn hình/TV', checked: false },
                    { id: 4, name: 'Kiểm tra Remote', checked: false },
                    { id: 5, name: 'Dọn bàn ghế', checked: false },
                    { id: 6, name: 'Thu gom ly/chai', checked: false },
                    { id: 7, name: 'Lau bàn', checked: false },
                    { id: 8, name: 'Hút bụi/Quét dọn', checked: false },
                    { id: 9, name: 'Kiểm tra vệ sinh WC', checked: false },
                    { id: 10, name: 'Xịt khử mùi', checked: false }
                ],
                startTime: new Date(),
                completedBy: null,
                completedAt: null
            };
        };
        
        this.startCleaning = function(roomId, staffName) {
            var checklist = this.getCleaningChecklist(roomId);
            checklist.staffName = staffName;
            checklists.push(checklist);
            this.saveChecklists();
            return checklist;
        };
        
        this.updateChecklist = function(roomId, itemId, checked) {
            var checklist = checklists.find(c => c.roomId == roomId && !c.completedAt);
            if (checklist) {
                var item = checklist.items.find(i => i.id == itemId);
                if (item) {
                    item.checked = checked;
                    this.saveChecklists();
                    return checklist;
                }
            }
            return null;
        };
        
        this.completeCleaning = function(roomId, staffName) {
            var checklist = checklists.find(c => c.roomId == roomId && !c.completedAt);
            if (checklist) {
                var allChecked = checklist.items.every(item => item.checked);
                if (allChecked) {
                    checklist.completedBy = staffName;
                    checklist.completedAt = new Date();
                    checklist.duration = Math.ceil((checklist.completedAt - checklist.startTime) / (1000 * 60));
                    this.saveChecklists();
                    return checklist;
                }
            }
            return null;
        };
        
        this.getActiveChecklist = function(roomId) {
            return checklists.find(c => c.roomId == roomId && !c.completedAt);
        };
        
        this.saveChecklists = function() {
            StorageService.set('checklists', checklists);
        };
        
        this.initChecklists = function() {
            checklists = StorageService.get('checklists') || [];
        };
        
        // Initialize
        this.initChecklists();
    }
]);
