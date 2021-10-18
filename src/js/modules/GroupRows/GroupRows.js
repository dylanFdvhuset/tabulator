import Module from '../../core/Module.js';

import GroupComponent from './GroupComponent.js';
import Group from './Group.js';

class GroupRows extends Module{

	constructor(table){
		super(table);

		this.groupIDLookups = false; //enable table grouping and set field to group by
		this.startOpen = [function(){return false;}]; //starting state of group
		this.headerGenerator = [function(){return "";}];
		this.groupList = []; //ordered list of groups
		this.allowedValues = false;
		this.groups = {}; //hold row groups
		this.displayIndex = 0; //index in display pipeline

		this.displayHandler = this.getRows.bind(this);

		//register table options
		this.registerTableOption("groupBy", false); //enable table grouping and set field to group by
		this.registerTableOption("groupStartOpen", true); //starting state of group
		this.registerTableOption("groupValues", false);
		this.registerTableOption("groupUpdateOnCellEdit", false);
		this.registerTableOption("groupHeader", false); //header generation function
		this.registerTableOption("groupHeaderPrint", null);
		this.registerTableOption("groupHeaderClipboard", null);
		this.registerTableOption("groupHeaderHtmlOutput", null);
		this.registerTableOption("groupHeaderDownload", null);
		this.registerTableOption("groupToggleElement", "arrow");
		this.registerTableOption("groupClosedShowCalcs", false);

		//register table functions
		this.registerTableFunction("setGroupBy", this.setGroupBy.bind(this));
		this.registerTableFunction("setGroupValues", this.setGroupValues.bind(this));
		this.registerTableFunction("setGroupStartOpen", this.setGroupStartOpen.bind(this));
		this.registerTableFunction("setGroupHeader", this.setGroupHeader.bind(this));
		this.registerTableFunction("getGroups", this.userGetGroups.bind(this));
		this.registerTableFunction("getGroupedData", this.userGetGroupedData.bind(this));

		//register component functions
		this.registerComponentFunction("row", "getGroup", this.rowGetGroup.bind(this));
	}

	//initialize group configuration
	initialize(){
		if(this.table.options.groupBy){
			var groupBy = this.table.options.groupBy,
			startOpen = this.table.options.groupStartOpen,
			groupHeader = this.table.options.groupHeader;

			this.allowedValues = this.table.options.groupValues;

			if(Array.isArray(groupBy) && Array.isArray(groupHeader) && groupBy.length > groupHeader.length){
				console.warn("Error creating group headers, groupHeader array is shorter than groupBy array");
			}

			this.headerGenerator = [function(){return "";}];
			this.startOpen = [function(){return false;}]; //starting state of group

			this.langBind("groups|item", (langValue, lang) => {
				this.headerGenerator[0] = (value, count, data) => { //header layout function
					return (typeof value === "undefined" ? "" : value) + "<span>(" + count + " " + ((count === 1) ? langValue : lang.groups.items) + ")</span>";
				};
			});

			this.groupIDLookups = [];

			if(Array.isArray(groupBy) || groupBy){
				if(this.table.modExists("columnCalcs") && this.table.options.columnCalcs != "table" && this.table.options.columnCalcs != "both"){
					this.table.modules.columnCalcs.removeCalcs();
				}
			}else{
				if(this.table.modExists("columnCalcs") && this.table.options.columnCalcs != "group"){

					var cols = this.table.columnManager.getRealColumns();

					cols.forEach((col) => {
						if(col.definition.topCalc){
							this.table.modules.columnCalcs.initializeTopRow();
						}

						if(col.definition.bottomCalc){
							this.table.modules.columnCalcs.initializeBottomRow();
						}
					});
				}
			}

			if(!Array.isArray(groupBy)){
				groupBy = [groupBy];
			}

			groupBy.forEach((group, i) => {
				var lookupFunc, column;

				if(typeof group == "function"){
					lookupFunc = group;
				}else{
					column = this.table.columnManager.getColumnByField(group);

					if(column){
						lookupFunc = function(data){
							return column.getFieldValue(data);
						};
					}else{
						lookupFunc = function(data){
							return data[group];
						};
					}
				}

				this.groupIDLookups.push({
					field: typeof group === "function" ? false : group,
					func:lookupFunc,
					values:this.allowedValues ? this.allowedValues[i] : false,
				});
			});

			if(startOpen){
				if(!Array.isArray(startOpen)){
					startOpen = [startOpen];
				}

				startOpen.forEach((level) => {
					level = typeof level == "function" ? level : function(){return true;};
				});

				this.startOpen = startOpen;
			}

			if(groupHeader){
				this.headerGenerator = Array.isArray(groupHeader) ? groupHeader : [groupHeader];
			}

			if(this.table.options.groupUpdateOnCellEdit){
				this.subscribe("cell-value-updated", this.cellUpdated.bind(this));
				this.subscribe("row-data-changed", this.reassignRowToGroup.bind(this), 0);
			}

			this.subscribe("row-deleting", this.rowDeleting.bind(this));
			this.subscribe("row-deleted", this.rowsUpdated.bind(this));
			this.subscribe("scroll-horizontal", this.scrollHeaders.bind(this));
			this.subscribe("rows-wipe", this.wipe.bind(this));
			this.subscribe("rows-added", this.rowsUpdated.bind(this));
			this.subscribe("row-moving", this.rowMoving.bind(this));
			this.subscribe("row-adding-index", this.rowAddingIndex.bind(this));

			this.subscribe("rows-sample", this.rowSample.bind(this));

			this.subscribe("render-virtual-fill", this.virtualRenderFill.bind(this));

			this.registerDisplayHandler(this.displayHandler, 20);

			this.initialized = true;
		}
	}

	rowSample(rows, prevValue){
		var group = this.getGroups(false)[0];

		prevValue.push(group.getRows(false)[0]);

		return prevValue;
	}

	virtualRenderFill(){
		var el = this.table.rowManager.tableElement;
		var rows = this.table.rowManager.getVisibleRows();

		rows = rows.filter((row) => {
			return row.type !== "group";
		});

		el.style.minWidth = !rows.length ? this.table.columnManager.getWidth() + "px" : "";

		// if(this.table.options.groupBy){
		// 	if(this.layoutMode() != "fitDataFill" && rowsCount == this.table.modules.groupRows.countGroups()){
		// 		el.style.minWidth = this.table.columnManager.getWidth() + "px";
		// 	}
		// }
	}

	rowAddingIndex(row, index, top){
		this.assignRowToGroup(row);

		var groupRows = row.modules.group.rows;

		if(groupRows.length > 1){
			if(!index || (index && groupRows.indexOf(index) == -1)){
				if(top){
					if(groupRows[0] !== row){
						index = groupRows[0];
						this.table.rowManager.moveRowInArray(row.modules.group.rows, row, index, !top);
					}
				}else{
					if(groupRows[groupRows.length -1] !== row){
						index = groupRows[groupRows.length -1];
						this.table.rowManager.moveRowInArray(row.modules.group.rows, row, index, !top);
					}
				}
			}else{
				this.table.rowManager.moveRowInArray(row.modules.group.rows, row, index, !top);
			}
		}

		return index;
	}

	trackChanges(){
		this.dispatch("group-changed");
	}

	///////////////////////////////////
	///////// Table Functions /////////
	///////////////////////////////////

	setGroupBy(groups){
		this.table.options.groupBy = groups;
		this.initialize();
		this.refreshData(false, "display");

		this.trackChanges();
	}

	setGroupValues(groupValues){
		this.table.options.groupValues = groupValues;
		this.initialize();
		this.refreshData(false, "display");

		this.trackChanges();
	}

	setGroupStartOpen(values){
		this.table.options.groupStartOpen = values;
		this.initialize();

		if(this.table.options.groupBy){
			this.refreshData();

			this.trackChanges();
		}else{
			console.warn("Grouping Update - cant refresh view, no groups have been set");
		}
	}

	setGroupHeader(values){
		this.table.options.groupHeader = values;
		this.initialize();

		if(this.table.options.groupBy){
			this.refreshData();

			this.trackChanges();
		}else{
			console.warn("Grouping Update - cant refresh view, no groups have been set");
		}
	}

	userGetGroups(values){
		return this.getGroups(true);
	}

	// get grouped table data in the same format as getData()
	userGetGroupedData(){
		return this.table.options.groupBy ?
		this.getGroupedData() : this.getData()
	}


	///////////////////////////////////////
	///////// Component Functions /////////
	///////////////////////////////////////

	rowGetGroup(row){
		return row.modules.group ? row.modules.group.getComponent() : false;
	}

	///////////////////////////////////
	///////// Internal Logic //////////
	///////////////////////////////////

	rowMoving(from, to, after){
		if(!after && to instanceof Group){
			to = this.table.rowManager.prevDisplayRow(from) || to;
		}

		var toGroup = to instanceof Group ? to : to.modules.group;
		var fromGroup = from instanceof Group ? from : from.modules.group;

		if(toGroup === fromGroup){
			this.table.rowManager.moveRowInArray(toGroup.rows, from, to, after);
		}else{
			if(fromGroup){
				fromGroup.removeRow(from);
			}

			toGroup.insertRow(from, to, after);
		}
	}


	rowDeleting(row){
		//remove from group
		if(row.modules.group){
			row.modules.group.removeRow(row);
		}
	}


	rowsUpdated(row){
		this.updateGroupRows(true);
	}

	cellUpdated(cell){
		this.reassignRowToGroup(cell.row);
	}


	setDisplayIndex(index){
		this.displayIndex = index;
	}

	getDisplayIndex(){
		return this.displayIndex;
	}

	//return appropriate rows with group headers
	getRows(rows){
		if(this.groupIDLookups.length){

			if(!Object.keys(this.groups).length){
				this.dispatchExternal("dataGrouping");

				this.generateGroups(rows);

				if(this.subscribedExternal("dataGrouped")){
					this.dispatchExternal("dataGrouped", this.getGroups(true));
				}
			}

			return this.updateGroupRows();

		}else{
			return rows.slice(0);
		}
	}

	getGroups(component){
		var groupComponents = [];

		this.groupList.forEach(function(group){
			groupComponents.push(component ? group.getComponent() : group);
		});

		return groupComponents;
	}

	getChildGroups(group){
		var groupComponents = [];

		if(!group){
			group = this;
		}

		group.groupList.forEach((child) => {
			if(child.groupList.length){
				groupComponents = groupComponents.concat(this.getChildGroups(child));
			}else{
				groupComponents.push(child);
			}
		});

		return groupComponents;
	}

	wipe(){
		this.groupList.forEach(function(group){
			group.wipe();
		});
	}

	pullGroupListData(groupList) {
		var groupListData = [];

		groupList.forEach((group) => {
			var groupHeader = {};
			groupHeader.level = 0;
			groupHeader.rowCount = 0;
			groupHeader.headerContent = "";
			var childData = [];

			if (group.hasSubGroups) {
				childData = this.pullGroupListData(group.groupList);

				groupHeader.level = group.level;
				groupHeader.rowCount = childData.length - group.groupList.length; // data length minus number of sub-headers
				groupHeader.headerContent = group.generator(group.key, groupHeader.rowCount, group.rows, group);

				groupListData.push(groupHeader);
				groupListData = groupListData.concat(childData);
			}

			else {
				groupHeader.level = group.level;
				groupHeader.headerContent = group.generator(group.key, group.rows.length, group.rows, group);
				groupHeader.rowCount = group.getRows().length;

				groupListData.push(groupHeader);

				group.getRows().forEach((row) => {
					groupListData.push(row.getData("data"));
				});
			}
		});

		return groupListData
	}

	getGroupedData(){

		return this.pullGroupListData(this.groupList);
	}

	getRowGroup(row){
		var match = false;

		this.groupList.forEach((group) => {
			var result = group.getRowGroup(row);

			if(result){
				match = result;
			}
		});

		return match;
	}

	countGroups(){
		return this.groupList.length;
	}

	generateGroups(rows){
		var oldGroups = this.groups;

		this.groups = {};
		this.groupList =[];

		if(this.allowedValues && this.allowedValues[0]){
			this.allowedValues[0].forEach((value) => {
				this.createGroup(value, 0, oldGroups);
			});

			rows.forEach((row) => {
				this.assignRowToExistingGroup(row, oldGroups);
			});
		}else{
			rows.forEach((row) => {
				this.assignRowToGroup(row, oldGroups);
			});
		}
	}

	createGroup(groupID, level, oldGroups){
		var groupKey = level + "_" + groupID,
		group;

		oldGroups = oldGroups || [];

		group = new Group(this, false, level, groupID, this.groupIDLookups[0].field, this.headerGenerator[0], oldGroups[groupKey]);

		this.groups[groupKey] = group;
		this.groupList.push(group);
	}

	assignRowToExistingGroup(row, oldGroups){
		var groupID = this.groupIDLookups[0].func(row.getData()),
		groupKey = "0_" + groupID;

		if(this.groups[groupKey]){
			this.groups[groupKey].addRow(row);
		}
	}

	assignRowToGroup(row, oldGroups){
		var groupID = this.groupIDLookups[0].func(row.getData()),
		newGroupNeeded = !this.groups["0_" + groupID];

		if(newGroupNeeded){
			this.createGroup(groupID, 0, oldGroups);
		}

		this.groups["0_" + groupID].addRow(row);

		return !newGroupNeeded;
	}

	reassignRowToGroup(row){
		if(row.type === "row"){
			var oldRowGroup = row.modules.group,
			oldGroupPath = oldRowGroup.getPath(),
			newGroupPath = this.getExpectedPath(row),
			samePath = true;

			// figure out if new group path is the same as old group path
			var samePath = (oldGroupPath.length == newGroupPath.length) && oldGroupPath.every((element, index) => {
				return element === newGroupPath[index];
			});

			// refresh if they new path and old path aren't the same (aka the row's groupings have changed)
			if(!samePath) {
				oldRowGroup.removeRow(row);
				this.assignRowToGroup(row, this.groups);
				this.refreshData(true);
			}
		}
	}

	getExpectedPath(row) {
		var groupPath = [], rowData = row.getData();

		this.groupIDLookups.forEach((groupId) => {
			groupPath.push(groupId.func(rowData));
		});

		return groupPath;
	}

	updateGroupRows(force){
		var output = [],
		oldRowCount;

		this.groupList.forEach((group) => {
			output = output.concat(group.getHeadersAndRows());
		});

		if(force){
			this.refreshData(true, this.displayHandler);
		}

		return output;
	}

	scrollHeaders(left){
		if(this.table.options.renderHorizontal === "virtual"){
			left -= this.table.columnManager.renderer.vDomPadLeft;
		}

		left = left + "px";

		this.groupList.forEach((group) => {
			group.scrollHeader(left);
		});
	}

	removeGroup(group){
		var groupKey = group.level + "_" + group.key,
		index;

		if(this.groups[groupKey]){
			delete this.groups[groupKey];

			index = this.groupList.indexOf(group);

			if(index > -1){
				this.groupList.splice(index, 1);
			}
		}
	}
}

GroupRows.moduleName = "groupRows";

export default GroupRows;