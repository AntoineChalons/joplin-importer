export interface JoplinFolder {
	id: string;
	parent_id?: string;
	title: string;
	children?: JoplinFolder[];
}

export interface JoplinNote {
	id: string;
	parent_id: string;
	title: string;
	body?: string;
	user_created_time?: number;
	user_updated_time?: number;
	is_todo?: number;
	todo_due?: number;
	todo_completed?: number;
	source_url?: string;
	author?: string;
	markup_language?: number;
	encryption_applied?: number;
}

export interface JoplinTag {
	id: string;
	title: string;
}

export interface JoplinResource {
	id: string;
	mime?: string;
	filename?: string;
	file_extension?: string;
	size?: number;
}
