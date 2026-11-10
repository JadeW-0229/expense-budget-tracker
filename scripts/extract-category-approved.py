"""Read the approved 11/09 workbook; never change original workbooks."""
from pathlib import Path
import json,hashlib,openpyxl
root=Path(__file__).resolve().parent.parent
source=next(root.parent.parent.glob('20261109_*.xlsx'))
w=openpyxl.load_workbook(source,data_only=True)
sheet=w['業務費總覽']
approved={}
for row in range(3,24):
    category=sheet.cell(row,1).value
    value=sheet.cell(row,7).value
    assert isinstance(category,int) and isinstance(value,(int,float)),(row,category,value)
    approved[str(category)]=value
assert len(approved)==21
assert sum(approved.values())==sheet['G25'].value-sheet['G24'].value
assert approved['21']==300000
result={'categoryApproved':approved,'categoryApprovedSource':{'workbook':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sheet':'業務費總覽','range':'G3:G23'}}
out=root/'private-import/category-approved.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print('Read-only approved amounts verified: 21 categories; total '+str(sum(approved.values())))
