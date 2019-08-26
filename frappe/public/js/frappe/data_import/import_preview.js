import DataTable from 'frappe-datatable';
import get_custom_column_manager from './custom_column_manager';
import ColumnPickerFields from './column_picker_fields';

frappe.provide('frappe.data_import');

const SVG_ICONS = {
	'checkbox-circle-line': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="import-success">
		<g>
			<path fill="none" d="M0 0h24v24H0z"/>
			<path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm-.997-4L6.76 11.757l1.414-1.414 2.829 2.829 5.656-5.657 1.415 1.414L11.003 16z"/>
		</g>
	</svg>`
};

frappe.data_import.ImportPreview = class ImportPreview {
	constructor({ wrapper, doctype, preview_data, import_log, events = {} }) {
		frappe.import_preview = this;
		this.wrapper = wrapper;
		this.doctype = doctype;
		this.preview_data = preview_data;
		this.events = events;
		this.import_log = import_log;

		frappe.model.with_doctype(doctype, () => {
			this.make_wrapper();
			this.refresh();
		});
	}

	refresh() {
		this.header_row = this.preview_data.header_row;
		this.fields = this.preview_data.fields;
		this.data = this.preview_data.data;
		this.warnings = this.preview_data.warnings;
		this.prepare_columns();
		this.prepare_data();
		this.render_warnings(this.warnings);
		this.render_datatable();
	}

	make_wrapper() {
		this.wrapper.html(`
			<div>
				<div class="warnings"></div>
				<div class="table-preview"></div>
				<div class="table-actions margin-top">
					<button class="btn btn-xs btn-default" data-action="add_row">
						${__('Add Row')}
					</button>
				</div>
			</div>
		`);
		frappe.utils.bind_actions_with_class(this.wrapper, this);

		this.$warnings = this.wrapper.find('.warnings');
		this.$table_preview = this.wrapper.find('.table-preview');
	}

	prepare_columns() {
		this.columns = this.fields.map((df, i) => {
			let header_row_index = i - 1;
			if (df.skip_import) {
				return {
					id: frappe.utils.get_random(6),
					name: df.label,
					skip_import: true,
					editable: false,
					focusable: false,
					header_row_index,
					format: (value, row, column, data) => {
						let html = `<div class="text-muted">${value}</div>`;
						if (df.label === 'Sr. No' && this.is_row_imported(row)) {
							html = `
								<div class="flex justify-between">${SVG_ICONS['checkbox-circle-line'] + html}</div>
							`;
						}
						return html;
					}
				};
			}

			let column_title = df.label;
			if (this.doctype !== df.parent) {
				column_title = `${df.label} (${df.parent})`;
			}
			let meta = frappe.get_meta(this.doctype);
			if (meta.autoname === `field:${df.fieldname}`) {
				column_title = `ID (${df.label})`;
			}
			return {
				id: df.fieldname,
				name: column_title,
				df: df,
				editable: true,
				align: 'left',
				header_row_index
			};
		});
	}

	prepare_data() {
		this.data = this.data.map(row => {
			return row.map(cell => {
				if (cell == null) {
					return '';
				}
				return cell;
			});
		});
	}

	render_warnings(warnings) {
		let warning_html = warnings
			.map(warning => {
				return `<div style="line-height: 2">${warning}</div>`;
			})
			.join('');

		let html = `<div class="border text-muted padding rounded margin-bottom">${warning_html}</div>`;
		this.$warnings.html(html);
	}

	render_datatable() {
		let self = this;

		this.datatable = new DataTable(this.$table_preview.get(0), {
			data: this.data,
			columns: this.columns,
			layout: 'fixed',
			cellHeight: 35,
			serialNoColumn: false,
			checkboxColumn: false,
			pasteFromClipboard: true,
			headerDropdown: [
				{
					label: __('Remap Column'),
					action: col => this.remap_column(col)
				},
				{
					label: __('Skip Import'),
					action: col => this.skip_import(col)
				}
			],
			overrideComponents: {
				ColumnManager: get_custom_column_manager(this.header_row)
			}
		});

		this.datatable.style.setStyle('.dt-dropdown__list-item:nth-child(-n+4)', {
			display: 'none'
		});

		this.add_color_to_column_header();
	}

	get_rows_as_csv_array() {
		return this.datatable.getRows().map(row => {
			return row.map(cell => cell.content);
		});
	}

	add_color_to_column_header() {
		let columns = this.datatable.getColumns();
		columns.forEach(col => {
			if (!col.skip_import && col.df) {
				this.datatable.style.setStyle(
					`.dt-header .dt-cell--col-${col.colIndex}, .dt-header .dt-cell--col-${
						col.colIndex
					} .dt-dropdown__toggle`,
					{
						backgroundColor: frappe.ui.color.get_color_shade(
							'green',
							'extra-light'
						),
						color: frappe.ui.color.get_color_shade('green', 'dark')
					}
				);
			}
			if (col.skip_import && col.name !== 'Sr. No') {
				this.datatable.style.setStyle(
					`.dt-header .dt-cell--col-${col.colIndex}, .dt-header .dt-cell--col-${
						col.colIndex
					} .dt-dropdown__toggle`,
					{
						backgroundColor: frappe.ui.color.get_color_shade(
							'orange',
							'extra-light'
						),
						color: frappe.ui.color.get_color_shade('orange', 'dark')
					}
				);
				this.datatable.style.setStyle(`.dt-cell--col-${col.colIndex}`, {
					backgroundColor: frappe.ui.color.get_color_shade('white', 'light')
				});
			}
		});
		this.datatable.style.setStyle(`svg.import-success`, {
			width: '16px',
			fill: frappe.ui.color.get_color_shade('green', 'dark')
		});
	}

	add_row() {
		this.data.push([]);
		this.datatable.refresh(this.data);
	}

	remap_column(col) {
		let column_picker_fields = new ColumnPickerFields({
			doctype: this.doctype
		});
		let dialog = new frappe.ui.Dialog({
			title: __('Remap Column: {0}', [col.name]),
			fields: [
				{
					fieldtype: 'Autocomplete',
					fieldname: 'fieldname',
					label: __('Select field'),
					max_items: Infinity,
					options: column_picker_fields.get_fields_as_options()
				}
			],
			primary_action: ({ fieldname }) => {
				if (!fieldname) return;
				this.events.remap_column(col.header_row_index, fieldname);
				dialog.hide();
			}
		});
		dialog.show();
	}

	skip_import(col) {
		this.events.skip_import(col.header_row_index);
	}

	is_row_imported(row) {
		let serial_no = row[0].content;
		return this.import_log.find(log => {
			return log.success && log.row_indexes.includes(serial_no);
		});
	}
};
